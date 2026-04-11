/**
 * Domain verification data management.
 * Fetches and caches the known domain SHA256 and verified domains list.
 * JS layer manages the cache, native layer uses the data for validation during fallback.
 */

import { DOMAIN_VERIFICATION_KEYS } from '@/constants/cache-keys';
import { kvGet, kvSet } from '@/database/kv';
import { fetchWithTimeout } from '@/utils';

// Remote verification list URL
const VERIFIED_LIST_URL = 'https://www.sing-box.net/verified_subscriptions_sha256.txt';

// Cache TTL: 24 hours
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Compile-time defaults
const DEFAULT_KNOWN_DOMAIN_SHA256 = '59fe86216c23236fb4c6ab50cd8d1e261b7cad754e3e7cab33058df5b32d12e1';

// ─────────────────────────────────────────────────────────────────────────────

export function getKnownDomainSha256(): string {
    return kvGet(DOMAIN_VERIFICATION_KEYS.KNOWN_SHA256) || DEFAULT_KNOWN_DOMAIN_SHA256;
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
 * Fetch and cache the verified domains list from sing-box.net.
 * Only updates if cache is stale (or forced).
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
    } catch (err) {
        console.warn('[DomainVerification] error updating verification data:', err);
    }
}

/**
 * Initialize verification data on app startup.
 * Fetches remote list if cache is stale.
 */
export async function initializeVerificationData(): Promise<void> {
    // Ensure we have at least the default known SHA256
    if (!kvGet(DOMAIN_VERIFICATION_KEYS.KNOWN_SHA256)) {
        kvSet(DOMAIN_VERIFICATION_KEYS.KNOWN_SHA256, DEFAULT_KNOWN_DOMAIN_SHA256);
    }

    // Fetch verified list if not cached or stale
    await updateVerificationData(false);
}

/**
 * Helper to compute SHA256 of a hostname.
 */
export async function sha256Hex(input: string): Promise<string> {
    const data = new TextEncoder().encode(input);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}
