/**
 * Log redaction helpers — pure, dependency-free (node:test covered).
 *
 * Config URLs embed secret tokens in path/query and hostnames are user
 * profile data, so neither may appear in the ring buffer, TaskLog, or
 * Bugsnag payloads (docs/claude/config-fetch-policy.md § log redaction).
 *
 * djb2 output here is a CORRELATION ID, not a security boundary — it is
 * short and brute-forceable by design (compact keys/log tokens). The
 * allowlist trust decisions stay on SHA256 (domain-suffix.ts). Never use
 * these hashes for verification.
 */

/** djb2, base36 — same algorithm/format as the historical kv.ts hashUrl. */
export function djb2Hash(input: string): string {
    let h = 5381;
    for (let i = 0; i < input.length; i++) {
        h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
    }
    return h.toString(36);
}

/** `#<djb2>` — correlates log lines about one host without naming it. */
export function redactHostname(host: string): string {
    return `#${djb2Hash(host)}`;
}

/**
 * `https://#ab3x9f/…#c9k2` (+`?…` when a query existed): scheme + host
 * hash + path hash + query-presence flag. No path or query text ever
 * survives. Unparseable input degrades to a fully hashed placeholder.
 */
export function redactUrl(rawUrl: string): string {
    try {
        const url = new URL(rawUrl);
        const pathPart = url.pathname && url.pathname !== '/' ? `/…#${djb2Hash(url.pathname)}` : '/';
        const queryFlag = url.search ? '?…' : '';
        return `${url.protocol}//${redactHostname(url.hostname)}${pathPart}${queryFlag}`;
    } catch {
        return `unparseable#${djb2Hash(rawUrl)}`;
    }
}
