/**
 * URL / header name-derivation helpers for profile imports — pure core.
 *
 * Moved verbatim out of src/utils.ts (which imports native modules) so the
 * import-flow machine and node's type-stripping test runner can use them.
 * src/utils.ts re-exports them; existing call sites are unaffected.
 */

/** Extract the hostname from a URL string; returns fallback on parse failure. */
export function urlHostname(url: string, fallback = ''): string {
    try { return new URL(url).hostname; } catch { return fallback; }
}

/**
 * Extract the last path segment (filename) from a URL, URL-decoded.
 * Used as a display-name fallback when the server does not return a
 * Content-Disposition header — e.g. raw gist URLs like
 * `/raw/abc/appstoreconnect.json` → `appstoreconnect.json`.
 * Returns null if parsing fails or the path has no filename segment.
 */
export function urlFilename(url: string): string | null {
    try {
        const pathname = new URL(url).pathname;
        const segments = pathname.split('/').filter(Boolean);
        const last = segments[segments.length - 1];
        if (!last) return null;
        try {
            return decodeURIComponent(last);
        } catch {
            return last;
        }
    } catch {
        return null;
    }
}

/**
 * Display-name fallback derived purely from a config URL: the last path
 * segment, else the hostname, else the literal 'Profile'. Shared by the
 * import flow (the final ?? branch after Content-Disposition / stored name)
 * and the v1 → multi-profile migration, so both spell one policy.
 */
export function deriveProfileNameFromUrl(url: string): string {
    return urlFilename(url) ?? urlHostname(url, 'Profile');
}

/** Parse profile name from a Content-Disposition header value. Returns null if not found. */
export function getRemoteNameByContentDisposition(contentDisposition: string): string | null {
    const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
    const matches = filenameRegex.exec(contentDisposition);
    if (matches != null && matches[1]) {
        return decodeURIComponent(matches[1].replace(/['"]/g, ''));
    }
    return null;
}
