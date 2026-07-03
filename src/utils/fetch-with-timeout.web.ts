/**
 * {@link fetchWithTimeout} 的 web mock。web 目标上没有原生 fetcher 与 sing-box
 * 核心，因此这里返回一个合成的配置 Response，让导入流程得以走通。web 端 Metro
 * 会选这个文件而非 fetch-with-timeout.ts（无运行时 Platform.OS 分支）。
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
