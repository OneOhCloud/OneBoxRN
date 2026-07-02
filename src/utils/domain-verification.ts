/**
 * Domain verification data management.
 * Fetches and caches the known domain SHA256 and verified domains list.
 * JS layer manages the cache, native layer uses the data for validation during fallback.
 */

import { DOMAIN_VERIFICATION_KEYS } from '@/constants/cache-keys';
import { kvGet, kvSet } from '@/database/kv';
import ExpoOneBox from '@/modules/expo-onebox';
import { fetchWithTimeout } from '@/utils';
import { hostnameMatchesAnyAllowlist } from '@/utils/domain-suffix';

// Remote verification list URL
const VERIFIED_LIST_URL = 'https://www.sing-box.net/verified_subscriptions_sha256.txt';

// Cache TTL: 24 hours
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Compile-time defaults. Each entry is the SHA256 of an approved suffix
// label; the consumer hashes every progressive suffix of the target
// hostname (shortest first) and returns true on the first match. Never
// record the pre-image here or in any comment.
const DEFAULT_KNOWN_DOMAIN_SHA256_LIST: readonly string[] = [
    '183a5526e76751b07cd57236bc8f253d5424e02a3fc7da7c30f80919e975125a',
    '59fe86216c23236fb4c6ab50cd8d1e261b7cad754e3e7cab33058df5b32d12e1',
    '61e245b4e5c234b00865ab0f47ad1cc4a9b37dbc50159febea7e6dcaee8ce050',
] as const;

// ─────────────────────────────────────────────────────────────────────────────

export function getKnownDomainSha256List(): string[] {
    const stored = kvGet(DOMAIN_VERIFICATION_KEYS.KNOWN_SHA256);
    if (!stored) return [...DEFAULT_KNOWN_DOMAIN_SHA256_LIST];
    // Historical: KV value may be either a JSON-encoded array (new shape)
    // or a single SHA256 hex string (pre-list shape). Fall back cleanly in
    // either case so an in-place upgrade does not strand a stale cache.
    try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.every(x => typeof x === 'string')) {
            return parsed;
        }
    } catch {
        // not JSON — assume legacy single-hash shape
    }
    return [stored];
}

export function getVerifiedDomainsList(): string[] {
    const cached = kvGet(DOMAIN_VERIFICATION_KEYS.VERIFIED_LIST);
    if (!cached) return [];
    try {
        const parsed = JSON.parse(cached);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

/**
 * Thin wrapper around the pure `hostnameMatchesAnyAllowlist` primitive:
 * reads both KV-backed allowlists and delegates the suffix-hash check.
 * On a miss, fires a non-blocking whitelist refresh (TTL-gated inside
 * `updateVerificationData`) so the next verify benefits from newer data.
 *
 * Mirrors OneBox/Tauri `verify_hostname` semantics: zero network in the
 * hot path, both the compile-time list and the remote-cached list
 * considered in one suffix traversal.
 */
export async function verifyHostname(hostname: string): Promise<boolean> {
    const known    = new Set<string>(getKnownDomainSha256List());
    const verified = new Set<string>(getVerifiedDomainsList());
    const ok       = await hostnameMatchesAnyAllowlist(hostname, known, verified);
    if (!ok) void updateVerificationData(false);
    return ok;
}

/**
 * Check if the cache is still valid (within TTL).
 */
function isCacheValid(): boolean {
    const cacheTime = kvGet(DOMAIN_VERIFICATION_KEYS.CACHE_TIME);
    if (!cacheTime) return false;
    try {
        const timestamp = parseInt(cacheTime, 10);
        return Date.now() - timestamp < CACHE_TTL_MS;
    } catch {
        return false;
    }
}

/**
 * Push the current KV cache into the native background worker so it can
 * verify hostnames without re-fetching the remote list on every wake.
 * Safe to call frequently — the native side just overwrites its copy.
 * Silent on failure (native module may be absent on web).
 */
async function pushVerificationDataToNative(): Promise<void> {
    try {
        await ExpoOneBox.setVerificationData({
            knownSha256List:    getKnownDomainSha256List(),
            verifiedSha256List: getVerifiedDomainsList(),
        });
    } catch (err) {
        console.warn('[DomainVerification] failed to push to native bg worker:', err);
    }
}

/**
 * Fetch and cache the verified domains list from sing-box.net.
 * Only updates if cache is stale (or forced). On any successful write,
 * re-pushes the full allowlist into the native background worker.
 */
export async function updateVerificationData(force: boolean = false): Promise<void> {
    if (!force && isCacheValid()) {
        return;
    }

    try {
        console.log('[DomainVerification] fetching verified domains list...');
        const resp = await fetchWithTimeout(VERIFIED_LIST_URL, {}, 10_000);

        if (!resp.ok) {
            console.warn(`[DomainVerification] failed to fetch list: HTTP ${resp.status}`);
            return;
        }

        const text = await resp.text();
        const hashes = text.split('\n').map(l => l.trim()).filter(Boolean);

        kvSet(DOMAIN_VERIFICATION_KEYS.VERIFIED_LIST, JSON.stringify(hashes));
        kvSet(DOMAIN_VERIFICATION_KEYS.CACHE_TIME, Date.now().toString());

        console.log(`[DomainVerification] cached ${hashes.length} verified domains`);
        await pushVerificationDataToNative();
    } catch (err) {
        console.warn('[DomainVerification] error updating verification data:', err);
    }
}

/**
 * Initialize verification data on app startup.
 * Fetches remote list if cache is stale, then pushes the seeded allowlist
 * into the native background worker so it is ready before any bg fire.
 */
export async function initializeVerificationData(): Promise<void> {
    // Ensure we have at least the default known-SHA256 list. Always rewrite
    // with the current defaults so builds that ship additional approved
    // entries replace an older single-hash value left over from v1.
    kvSet(
        DOMAIN_VERIFICATION_KEYS.KNOWN_SHA256,
        JSON.stringify(DEFAULT_KNOWN_DOMAIN_SHA256_LIST),
    );

    // Push defaults now so a bg fire before the network returns still sees
    // the compile-time list in the shared store.
    await pushVerificationDataToNative();

    // Fetch verified list if not cached or stale (pushes again on success).
    await updateVerificationData(false);
}

