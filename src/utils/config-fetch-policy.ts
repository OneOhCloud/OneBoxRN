/**
 * Config-fetch policy core — the executable mirror of
 * docs/claude/config-fetch-policy.md. Pure and dependency-free
 * (node:test covered); JS consumers classify native/fetch errors into
 * the shared errorCode vocabulary and evaluate fallback eligibility
 * with the same rules the native fetchers implement.
 */

export type FetchErrorKind =
    | 'timeout'
    | 'dns'
    | 'network'
    | 'tls'
    | 'http'
    | 'cancelled'
    | 'unknown';

/**
 * Best-effort classification of a fetch-layer error. Name checks cover
 * the WinterCG/XHR surface (AbortError/TypeError); message checks cover
 * native bridge rejections whose text is the only signal.
 */
export function classifyFetchError(err: { name?: string; message?: string }): FetchErrorKind {
    const name = err.name ?? '';
    const message = (err.message ?? '').toLowerCase();

    if (message.includes('cancelled') || message.includes('canceled')) return 'cancelled';
    if (name === 'AbortError' || message.includes('timed out') || message.includes('timeout')) {
        return 'timeout';
    }
    if (message.includes('dns') || message.includes('resolution') || message.includes('resolve')) {
        return 'dns';
    }
    if (
        message.includes('certificate') ||
        message.includes('trust') ||
        message.includes('tls') ||
        message.includes('ssl handshake')
    ) {
        return 'tls';
    }
    if (message.match(/http\s+[45]\d\d/)) return 'http';
    if (name === 'TypeError' || message.includes('network')) return 'network';
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
