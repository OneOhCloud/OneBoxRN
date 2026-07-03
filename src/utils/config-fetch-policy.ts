/**
 * 配置拉取策略核心 —— docs/claude/config-fetch-policy.md 的可执行镜像。
 * 纯函数、无依赖（node:test 覆盖）。两类职责：
 *   - `classifyFetchError` / `errorCodeOf` 在生产中运行，把原生/fetch
 *     错误映射到共享的 errorCode 词表。
 *   - `shouldFallbackToAccelerator` 编码原生 fetcher 实现的回落资格规则。
 *     它没有生产 JS 调用方 —— 只是测试套件锁定的规范镜像，因此一旦偏离
 *     文档化的策略，就会以测试失败暴露出来。原生回落行为变更时要同步更新它。
 */

export type FetchErrorKind =
    | 'timeout'
    | 'dns'
    | 'network'
    | 'tls'
    | 'http'
    | 'cancelled'
    | 'unknown';

/** 从自由文本中捕获任意 3 位 HTTP 状态码，例如 "HTTP 403 from primary" → "403"。 */
export const HTTP_STATUS_PATTERN = /http\s+(\d{3})/i;

/**
 * 原生/fetch 错误面的有序自由文本特征表。
 *
 * 为何用子串/正则嗅探：有些错误到达 JS 时只是一条原生桥接的 rejection
 * 字符串 —— Kotlin/Swift → JS 桥接之间没有结构化错误码，而新增一个属于
 * 桥接签名改动，超出本模块范围。此表是这类脆弱匹配的唯一集中处：新的
 * 原生错误措辞都加到这里（切勿内联），使分类可审计、测试套件能锁定每个分支。
 *
 * 顺序有意义 —— 一条消息可能匹配多行（例如一次超时的 DNS 查询），先匹配到
 * 的行胜出。所有 `substrings` 均为小写，与小写化后的消息比对；`names` 与
 * 错误的 `name` 比对（WinterCG/XHR 面：AbortError/TypeError）。
 */
const ERROR_SIGNATURES: readonly {
    kind: FetchErrorKind;
    names?: readonly string[];
    substrings?: readonly string[];
    pattern?: RegExp;
}[] = [
    { kind: 'cancelled', substrings: ['cancelled', 'canceled'] },
    { kind: 'timeout', names: ['AbortError'], substrings: ['timed out', 'timeout'] },
    { kind: 'dns', substrings: ['dns', 'resolution', 'resolve'] },
    { kind: 'tls', substrings: ['certificate', 'trust', 'tls', 'ssl handshake'] },
    // 只有 4xx/5xx 算 "http" 故障；说明服务器可达并作出了应答。
    { kind: 'http', pattern: /http\s+[45]\d\d/ },
    { kind: 'network', names: ['TypeError'], substrings: ['network'] },
];

/**
 * 尽力而为地对 fetch 层错误分类。name 检查覆盖 WinterCG/XHR 面
 * （AbortError/TypeError）；message 检查覆盖那些只有文本可依据的原生桥接
 * rejection。集中匹配表见 `ERROR_SIGNATURES`。
 */
export function classifyFetchError(err: { name?: string; message?: string }): FetchErrorKind {
    const name = err.name ?? '';
    const message = (err.message ?? '').toLowerCase();

    for (const signature of ERROR_SIGNATURES) {
        const nameMatch = signature.names?.includes(name) ?? false;
        const substringMatch = signature.substrings?.some((needle) => message.includes(needle)) ?? false;
        const patternMatch = signature.pattern?.test(message) ?? false;
        if (nameMatch || substringMatch || patternMatch) return signature.kind;
    }
    return 'unknown';
}

/** 结构化事件与持久失败共用的 errorCode 词表。 */
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

/**
 * 把原始的原生/fetch 错误字符串转成共享的 errorCode 词表，消息里带 HTTP
 * 状态码时一并取出（例如 "HTTP 403 from primary" → "HTTP_403"）。这是
 * 消息 → 码 的唯一入口，由启动失败与配置刷新遥测共用。
 */
export function errorCodeFromMessage(message: string | undefined): string | undefined {
    if (!message) return undefined;
    const kind = classifyFetchError({ message });
    const httpStatus = message.match(HTTP_STATUS_PATTERN);
    return errorCodeOf(kind, httpStatus ? Number(httpStatus[1]) : undefined);
}

export type ConfigContentVerdict =
    | { ok: true }
    | { ok: false; reason: 'empty' | 'not-json' | 'not-object' };

/** 2xx 响应但响应体校验失败时共用的 errorCode。 */
export const ERROR_CODE_INVALID_CONTENT = 'INVALID_CONTENT';

/**
 * 下载配置体的准入闸门：sing-box 配置在顶层是一个 JSON 对象。守护 import
 * 与 refresh 的存储步骤 —— HTTP 200 但响应体无法解码（例如代理透传了压缩
 * 字节）必须让流程失败，而不是静默持久化。
 */
export function validateConfigContent(content: string): ConfigContentVerdict {
    if (content.trim() === '') return { ok: false, reason: 'empty' };
    let parsed: unknown;
    try {
        parsed = JSON.parse(content);
    } catch {
        return { ok: false, reason: 'not-json' };
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { ok: false, reason: 'not-object' };
    }
    return { ok: true };
}

export type FallbackDenialReason =
    | 'network-fault'
    | 'http-no-fallback'
    | 'cancelled'
    | 'unverified-domain'
    | 'accelerator-unavailable';

/**
 * 策略表行查询：这次失败能否走加速代理？HTTP 应答与取消一律不回落；
 * 网络故障仅在域名已验证且配置了加速代理时才回落。
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
