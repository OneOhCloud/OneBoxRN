/**
 * 原生启动失败状态机的 token → i18n key。
 *
 * 原生层（Kotlin / Swift）发出这些稳定、与语言无关的 token 而非本地化文本，
 * 好让 JS 层把它们映射到用户语言。任何不是已知 token 的消息都原样透传 ——
 * 那是原始的 sing-box/二进制错误细节（本就是英文/技术性的），并非面向用户的文案。
 */
export const STARTUP_ERROR_TOKEN_KEYS: Record<string, string> = {
    START_FAILED_GENERIC: 'startup_error_generic',
    RULESET_DOWNLOAD_RESET: 'ruleset_download_reset',
    RULESET_DOWNLOAD_UNREACHABLE: 'ruleset_download_unreachable',
    RULESET_DOWNLOAD_TIMEOUT: 'ruleset_download_timeout',
};

/** 返回某个原生启动错误 token 对应的 i18n key；若不是 token 则返回 null。 */
export function startupErrorTokenToKey(message: string | null | undefined): string | null {
    if (!message) return null;
    return STARTUP_ERROR_TOKEN_KEYS[message.trim()] ?? null;
}
