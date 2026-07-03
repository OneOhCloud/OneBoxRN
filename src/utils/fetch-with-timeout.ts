import { fetch } from 'expo/fetch';

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Fetch with an automatic timeout via AbortController (default 10s). If the
 * caller passes a signal, aborting either signal cancels the request.
 *
 * Web has a mock sibling (fetch-with-timeout.web.ts) that Metro selects on the
 * web target, so this shared path never branches on `Platform.OS` at runtime
 * (project rule — audit D9-07).
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
