/**
 * Native startup-failure machine tokens → i18n keys.
 *
 * The native layers (Kotlin / Swift) emit these stable, language-neutral tokens
 * instead of localized text, so the JS layer can map them to the user's language
 * (audit C9 / D3a-06 / D3a-07 / D3b-11). Any message that is NOT a known token is
 * passed through verbatim — it is raw sing-box/binary error detail (already
 * English/technical), not user-facing copy.
 */
export const STARTUP_ERROR_TOKEN_KEYS: Record<string, string> = {
    START_FAILED_GENERIC: 'startup_error_generic',
    RULESET_DOWNLOAD_RESET: 'ruleset_download_reset',
    RULESET_DOWNLOAD_UNREACHABLE: 'ruleset_download_unreachable',
    RULESET_DOWNLOAD_TIMEOUT: 'ruleset_download_timeout',
};

/** Returns the i18n key for a native startup-error token, or null if not a token. */
export function startupErrorTokenToKey(message: string | null | undefined): string | null {
    if (!message) return null;
    return STARTUP_ERROR_TOKEN_KEYS[message.trim()] ?? null;
}
