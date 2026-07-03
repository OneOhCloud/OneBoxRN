/**
 * Config-fetch policy core — the executable mirror of
 * docs/claude/config-fetch-policy.md. Pure and dependency-free
 * (node:test covered). Two roles:
 *   - `classifyFetchError` / `errorCodeOf` run in production to map
 *     native/fetch errors into the shared errorCode vocabulary.
 *   - `shouldFallbackToAccelerator` encodes the fallback-eligibility rules
 *     the native fetchers implement. It has no production JS caller — it is
 *     a spec mirror the test suite locks against, so drift from the
 *     documented policy surfaces as a test failure. Keep it in sync when
 *     native fallback behavior changes.
 */

export type FetchErrorKind =
    | 'timeout'
    | 'dns'
    | 'network'
    | 'tls'
    | 'http'
    | 'cancelled'
    | 'unknown';

/** Captures any 3-digit HTTP status from free text, e.g. "HTTP 403 from primary" → "403". */
export const HTTP_STATUS_PATTERN = /http\s+(\d{3})/i;

/**
 * Ordered free-text signatures for the native/fetch error surface.
 *
 * WHY substring/regex sniffing: some errors reach JS only as a native-bridge
 * rejection string — there is no structured error code across the
 * Kotlin/Swift → JS bridge, and adding one is a bridge-signature change out of
 * this module's scope. This table is the single, centralized home for that
 * fragile matching: add new native error phrasings here (never inline) so
 * classification stays auditable and the test suite can lock every branch.
 *
 * Order is significant — a message may match several rows (e.g. a DNS lookup
 * that timed out), and the first matching row wins. All `substrings` are
 * lowercase and matched against the lowercased message; `names` are matched
 * against the error's `name` (WinterCG/XHR surface: AbortError/TypeError).
 */
const ERROR_SIGNATURES: readonly {
    kind: FetchErrorKind;
    names?: readonly string[];
    substrings?: readonly string[];
    pattern?: RegExp;
}[] = [
    { kind: 'cancelled', substrings: ['cancelled', 'canceled'] },
    { kind: 'timeout', names: ['AbortError'], substrings: ['timed out', 'timeout'] },
    { kind: 'dns', substrings: ['dns', 'resolution', 'resolve'] },
    { kind: 'tls', substrings: ['certificate', 'trust', 'tls', 'ssl handshake'] },
    // Only 4xx/5xx count as an "http" fault; a reachable server answered.
    { kind: 'http', pattern: /http\s+[45]\d\d/ },
    { kind: 'network', names: ['TypeError'], substrings: ['network'] },
];

/**
 * Best-effort classification of a fetch-layer error. Name checks cover
 * the WinterCG/XHR surface (AbortError/TypeError); message checks cover
 * native bridge rejections whose text is the only signal. See
 * `ERROR_SIGNATURES` for the centralized match table.
 */
export function classifyFetchError(err: { name?: string; message?: string }): FetchErrorKind {
    const name = err.name ?? '';
    const message = (err.message ?? '').toLowerCase();

    for (const signature of ERROR_SIGNATURES) {
        const nameMatch = signature.names?.includes(name) ?? false;
        const substringMatch = signature.substrings?.some((needle) => message.includes(needle)) ?? false;
        const patternMatch = signature.pattern?.test(message) ?? false;
        if (nameMatch || substringMatch || patternMatch) return signature.kind;
    }
    return 'unknown';
}

/** Shared errorCode vocabulary for structured events + durable failures. */
export function errorCodeOf(kind: FetchErrorKind, httpStatus?: number): string {
    switch (kind) {
        case 'timeout':
            return 'TIMEOUT';
        case 'dns':
            return 'DNS';
        case 'network':
            return 'NETWORK';
        case 'tls':
            return 'TLS';
        case 'http':
            return httpStatus !== undefined ? `HTTP_${httpStatus}` : 'HTTP';
        case 'cancelled':
            return 'CANCELLED';
        case 'unknown':
            return 'UNKNOWN';
    }
}

/**
 * Turn a raw native/fetch error string into the shared errorCode vocabulary,
 * pulling an HTTP status out of the message when present
 * (e.g. "HTTP 403 from primary" → "HTTP_403"). The single home for message →
 * code, shared by start-failure and config-refresh telemetry.
 */
export function errorCodeFromMessage(message: string | undefined): string | undefined {
    if (!message) return undefined;
    const kind = classifyFetchError({ message });
    const httpStatus = message.match(HTTP_STATUS_PATTERN);
    return errorCodeOf(kind, httpStatus ? Number(httpStatus[1]) : undefined);
}

export type ConfigContentVerdict =
    | { ok: true }
    | { ok: false; reason: 'empty' | 'not-json' | 'not-object' };

/** Shared errorCode for a 2xx response whose body fails validation. */
export const ERROR_CODE_INVALID_CONTENT = 'INVALID_CONTENT';

/**
 * Acceptance gate for downloaded config bodies: a sing-box config is a
 * JSON object at the top level. Guards the store step of import and
 * refresh — an HTTP 200 with an undecodable body (e.g. a proxy handing
 * through compressed bytes) must fail the flow, not silently persist.
 */
export function validateConfigContent(content: string): ConfigContentVerdict {
    if (content.trim() === '') return { ok: false, reason: 'empty' };
    let parsed: unknown;
    try {
        parsed = JSON.parse(content);
    } catch {
        return { ok: false, reason: 'not-json' };
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { ok: false, reason: 'not-object' };
    }
    return { ok: true };
}

export type FallbackDenialReason =
    | 'network-fault'
    | 'http-no-fallback'
    | 'cancelled'
    | 'unverified-domain'
    | 'accelerator-unavailable';

/**
 * Policy-table row lookup: may this failure proceed to the accelerator?
 * HTTP answers and cancellations never fall back; network faults fall
 * back only for verified domains with a configured accelerator.
 */
export function shouldFallbackToAccelerator(
    kind: FetchErrorKind,
    opts: { domainVerified: boolean; acceleratorConfigured: boolean },
): { fallback: boolean; reason: FallbackDenialReason } {
    if (kind === 'http') return { fallback: false, reason: 'http-no-fallback' };
    if (kind === 'cancelled') return { fallback: false, reason: 'cancelled' };
    if (!opts.domainVerified) return { fallback: false, reason: 'unverified-domain' };
    if (!opts.acceleratorConfigured) return { fallback: false, reason: 'accelerator-unavailable' };
    return { fallback: true, reason: 'network-fault' };
}
