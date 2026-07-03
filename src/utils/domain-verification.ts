/**
 * 域名验证数据管理。
 * 拉取并缓存已知域名 sha256 与已验证域名列表。
 * JS 层负责管理缓存，原生层在回落时用这些数据做校验。
 */

import { DOMAIN_VERIFICATION_KEYS } from '@/constants/cache-keys';
import { kvGet, kvSet } from '@/database/kv';
import ExpoOneBox from '@/modules/expo-onebox';
import { fetchWithTimeout } from '@/utils';
import { hostnameMatchesAnyAllowlist } from '@/utils/domain-suffix';

// 远程验证列表 URL
const VERIFIED_LIST_URL = 'https://www.sing-box.net/verified_subscriptions_sha256.txt';

// 缓存 TTL：24 小时
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// 编译期默认值。每一项是某个受信后缀标签的 sha256；消费方会对目标
// hostname 的每一级渐进后缀（从最短开始）做哈希，命中即返回 true。
// 严禁在此处或任何注释里记录其明文原像。
const DEFAULT_KNOWN_DOMAIN_SHA256_LIST: readonly string[] = [
    '183a5526e76751b07cd57236bc8f253d5424e02a3fc7da7c30f80919e975125a',
    '59fe86216c23236fb4c6ab50cd8d1e261b7cad754e3e7cab33058df5b32d12e1',
    '61e245b4e5c234b00865ab0f47ad1cc4a9b37dbc50159febea7e6dcaee8ce050',
] as const;

// ─────────────────────────────────────────────────────────────────────────────

export function getKnownDomainSha256List(): string[] {
    const stored = kvGet(DOMAIN_VERIFICATION_KEYS.KNOWN_SHA256);
    if (!stored) return [...DEFAULT_KNOWN_DOMAIN_SHA256_LIST];
    // KV 值可能是 JSON 编码的数组，也可能是单个 sha256 十六进制字符串；
    // 两种形态都要能干净回退，避免升级后旧缓存被搁置。
    try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.every(x => typeof x === 'string')) {
            return parsed;
        }
    } catch {
        // 非 JSON —— 按单哈希形态处理
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
 * 对纯函数 `hostnameMatchesAnyAllowlist` 的薄封装：读取两份 KV 支撑的
 * 白名单，把后缀哈希校验委托给它。未命中时触发一次非阻塞的白名单刷新
 * （TTL 门控在 `updateVerificationData` 内部），让下一次校验用上更新的数据。
 *
 * 与 OneBox/Tauri 的 `verify_hostname` 语义一致：热路径零网络，编译期列表
 * 与远程缓存列表在一次后缀遍历中一并考虑。
 */
export async function verifyHostname(hostname: string): Promise<boolean> {
    // 与原生验证器一样 fail-closed：KV 缓存的列表（JS 推入的 known +
    // 远程 verified）仅在 TTL 内可信；一旦过期，就回落到始终可用的编译期
    // 列表，直到下方的非阻塞刷新重新填充缓存。
    const cacheValid = isCacheValid();
    const known    = new Set<string>(cacheValid ? getKnownDomainSha256List() : [...DEFAULT_KNOWN_DOMAIN_SHA256_LIST]);
    const verified = new Set<string>(cacheValid ? getVerifiedDomainsList() : []);
    const ok       = await hostnameMatchesAnyAllowlist(hostname, known, verified);
    if (!ok) void updateVerificationData(false);
    return ok;
}

/**
 * 检查缓存是否仍在有效期（TTL）内。
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
 * 把当前 KV 缓存推入原生后台 worker，使其每次唤醒都无需重新拉取远程列表
 * 即可校验 hostname。可频繁调用 —— 原生侧只是覆盖自己的副本。
 * 失败时静默（web 上可能没有原生模块）。
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
 * 从 sing-box.net 拉取并缓存已验证域名列表。
 * 仅在缓存过期（或强制）时更新；每次成功写入后，都会把完整白名单重新
 * 推入原生后台 worker。
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
 * 应用启动时初始化验证数据。
 * 缓存过期则拉取远程列表，随后把已就绪的白名单推入原生后台 worker，
 * 确保在任何后台触发之前它就已备好。
 */
export async function initializeVerificationData(): Promise<void> {
    // 至少保证存在默认的 known-sha256 列表；每次都用当前默认值覆盖写入，
    // 让新增受信条目的构建覆盖掉此前缓存的旧值。
    kvSet(
        DOMAIN_VERIFICATION_KEYS.KNOWN_SHA256,
        JSON.stringify(DEFAULT_KNOWN_DOMAIN_SHA256_LIST),
    );

    // 现在就推入默认值，让网络返回前触发的后台任务也能在共享存储里
    // 看到编译期列表。
    await pushVerificationDataToNative();

    // 未缓存或已过期时拉取已验证列表（成功后会再次推入）。
    await updateVerificationData(false);
}

