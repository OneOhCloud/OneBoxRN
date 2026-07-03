import { fetch } from 'expo/fetch';

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * 通过 AbortController 带自动超时的 fetch（默认 10s）。若调用方传入 signal，
 * 任一 signal 被 abort 都会取消请求。
 *
 * web 端有一个 mock 兄弟文件（fetch-with-timeout.web.ts），Metro 在 web 目标上
 * 会选它，因此这条共享路径在运行时从不按 `Platform.OS` 分支（项目规则）。
 */
export async function fetchWithTimeout(
    input: string,
    init?: RequestInit,
    timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const callerSignal = init?.signal;
    if (callerSignal) {
        if (callerSignal.aborted) {
            controller.abort();
        } else {
            callerSignal.addEventListener('abort', () => controller.abort(), { once: true });
        }
    }

    try {
        const { signal: _ignored, ...rest } = init || {};
        const resp = await fetch(input, { ...rest, signal: controller.signal } as any);
        return resp;
    } finally {
        clearTimeout(timeoutId);
    }
}
