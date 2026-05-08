/**
 * Pure helpers for suffix-based hostname allowlist matching.
 *
 * Kept dependency-free (no project imports, no React Native APIs) so the
 * committed `domain-suffix.test.ts` can exercise them under Node's native
 * `--experimental-strip-types` + `node:test`.
 *
 * Consumers: `profile-loader.ts` (foreground config fetch) and
 * `domain-verification.ts` (background cache refresh).
 */

/**
 * Progressive suffix candidates, shortest first.
 *   "a.b.c" → ["c", "b.c", "a.b.c"]
 * Single-label hostnames and IP literals return just the input.
 */
export function hostnameSuffixCandidates(hostname: string): string[] {
    if (!hostname) return [];
    const parts = hostname.split('.');
    const out: string[] = [];
    for (let i = parts.length - 1; i >= 0; i--) {
        out.push(parts.slice(i).join('.'));
    }
    return out;
}

/**
 * SHA256 hex digest.
 *
 * Two branches — the first that can actually compute a digest wins:
 *   1. `crypto.subtle` — present in Node ≥20 (covers the `--experimental-strip-types`
 *      test runner) and in browsers. Hermes in RN 0.83 does NOT expose this;
 *      any call there throws `Property 'crypto' doesn't exist`.
 *   2. `expo-crypto` — lazy-imported so the Node test runner never tries to
 *      resolve a native module. Uses iOS CommonCrypto / Android MessageDigest
 *      under the hood, so it works in every RN build of this app.
 */
export async function sha256Hex(input: string): Promise<string> {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
        const data = new TextEncoder().encode(input);
        const buf = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(buf))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }
    const Crypto = await import('expo-crypto');
    return Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        input,
        { encoding: Crypto.CryptoEncoding.HEX },
    );
}

/**
 * True iff any suffix of `hostname` (shortest first) hashes to an entry
 * in `allowedHashes`. A match at a broader suffix approves every child
 * hostname — callers decide how broad an entry may be.
 */
export async function hostnameMatchesAllowlist(
    hostname: string,
    allowedHashes: ReadonlySet<string>,
): Promise<boolean> {
    for (const suffix of hostnameSuffixCandidates(hostname)) {
        if (allowedHashes.has(await sha256Hex(suffix))) return true;
    }
    return false;
}

/**
 * Multi-allowlist variant of `hostnameMatchesAllowlist`. Returns true iff
 * any suffix of `hostname` (shortest first) hashes to an entry in any of
 * the supplied sets. Mirrors the two-list check in OneBox's Rust
 * `verify_hostname` (compile-time list ∪ cached remote list) — each
 * suffix is hashed at most once and tested against every allowlist
 * before moving to the next suffix.
 *
 * Zero allowlists → always false. Empty sets are safely ignored.
 */
export async function hostnameMatchesAnyAllowlist(
    hostname: string,
    ...allowlists: ReadonlySet<string>[]
): Promise<boolean> {
    if (allowlists.length === 0) return false;
    for (const suffix of hostnameSuffixCandidates(hostname)) {
        const h = await sha256Hex(suffix);
        for (const allow of allowlists) {
            if (allow.has(h)) return true;
        }
    }
    return false;
}
