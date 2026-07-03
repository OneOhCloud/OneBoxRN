/**
 * KV 存储操作用的集中式缓存 key 常量。
 * 避免全代码库里 key 的重复与拼写错误。
 */

export const DOMAIN_VERIFICATION_KEYS = {
    KNOWN_SHA256: 'dev:known-domain-sha256',
    VERIFIED_LIST: 'dev:verified-domains-list',
    CACHE_TIME: 'dev:verified-domains-cache-time',
} as const;

export const CONFIG_REFRESH_KEYS = {
    TEST_PRIMARY_URL_UNAVAILABLE: 'dev:test-primary-url-unavailable',
} as const;
