/**
 * Web mock of {@link fetchWithTimeout}. On the web target the native fetcher and
 * sing-box core are absent, so this returns a synthetic config Response that lets
 * the import flow be exercised. Metro selects this file over
 * fetch-with-timeout.ts on web (audit D9-07 — no runtime Platform.OS branch).
 */
export async function fetchWithTimeout(
    input: string,
    _init?: RequestInit,
    _timeoutMs?: number,
): Promise<Response> {
    const { buildMockConfigBody, buildMockUserinfoHeader } = await import('../modules/expo-onebox/src/ExpoOneBoxModule.web');
    return new Response(buildMockConfigBody(input), {
        status: 200,
        headers: {
            'content-type': 'application/json',
            'subscription-userinfo': buildMockUserinfoHeader(),
        },
    });
}
