/**
 * Centralized cache key constants for KV store operations.
 * Prevents key duplication and typos across the codebase.
 */

export const DOMAIN_VERIFICATION_KEYS = {
    KNOWN_SHA256: 'dev:known-domain-sha256',
    VERIFIED_LIST: 'dev:verified-domains-list',
    CACHE_TIME: 'dev:verified-domains-cache-time',
} as const;

export const CONFIG_REFRESH_KEYS = {
    TEST_PRIMARY_URL_UNAVAILABLE: 'dev:test-primary-url-unavailable',
    ACCELERATE_URL: 'config:accelerate-url',
} as const;
