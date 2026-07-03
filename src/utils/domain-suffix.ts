/**
 * 基于后缀的 hostname 白名单匹配纯函数。
 *
 * 保持无依赖（不引入项目模块、不用 React Native API），使随仓库提交的
 * `domain-suffix.test.ts` 能在 Node 原生的 `--experimental-strip-types` +
 * `node:test` 下运行。
 *
 * 消费方：`domain-verification.ts`（hostname 验证 + 后台缓存刷新）。
 */

/**
 * 渐进式后缀候选，从最短开始。
 *   "a.b.c" → ["c", "b.c", "a.b.c"]
 * 单标签 hostname 与 IP 字面量只返回输入本身。
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
 * SHA256 十六进制摘要。
 *
 * 两条分支 —— 谁能真正算出摘要谁就胜出：
 *   1. `crypto.subtle` —— Node ≥20（覆盖 `--experimental-strip-types` 测试运行器）
 *      与浏览器里都有。RN 0.83 的 Hermes 不暴露它；在那里调用会抛
 *      `Property 'crypto' doesn't exist`。
 *   2. `expo-crypto` —— 惰性 import，避免 Node 测试运行器去解析原生模块。
 *      底层用 iOS CommonCrypto / Android MessageDigest，因此在本应用的每个
 *      RN 构建里都能工作。
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
 * 当 `hostname` 的任一后缀（从最短开始）哈希命中 `allowedHashes` 中的某项时
 * 返回 true。更宽的后缀命中会放行其下所有子 hostname —— 由调用方决定条目
 * 可以放到多宽。
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
 * `hostnameMatchesAllowlist` 的多白名单变体。当 `hostname` 的任一后缀
 * （从最短开始）哈希命中任一传入集合中的某项时返回 true。与 OneBox Rust
 * `verify_hostname` 的两列表检查一致（编译期列表 ∪ 缓存的远程列表）——
 * 每个后缀最多哈希一次，并在进入下一个后缀前对每份白名单都测试一遍。
 *
 * 零个白名单 → 恒为 false。空集合会被安全忽略。
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
