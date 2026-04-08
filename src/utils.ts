import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { getLocales } from 'expo-localization';
import { fetch } from 'expo/fetch';
import { Platform } from 'react-native';
import ExpoOneBox from './modules/expo-onebox';

const DEFAULT_TIMEOUT_MS = 10_000;

const iOSTag = 'SFI';
const AndroidTag = 'SFA';

export function getSingBoxUserAgent(): string {
    const version = Constants.expoConfig?.version || 'unknown';

    const platform = Platform.OS;

    const cpuArchs = Device?.supportedCpuArchitectures?.[0] || 'unknown';
    const singboxVersion = ExpoOneBox.getLibBoxVersion();
    const locales = getLocales();
    const language = locales && locales.length > 0 ? locales[0].languageTag : 'zh-Hans-CN';

    let preSuffix = iOSTag;
    if (platform === 'android') {
        preSuffix = AndroidTag;
    }
    const ua = `${preSuffix}/${version}`;
    const deviceInfo = `${platform} ${cpuArchs} ${Platform.Version}`;
    const formatUA = `${ua} (${deviceInfo}; sing-box ${singboxVersion}; language ${language})`;

    return formatUA;
}

/** Extract the hostname from a URL string; returns fallback on parse failure. */
export function urlHostname(url: string, fallback = ''): string {
    try { return new URL(url).hostname; } catch { return fallback; }
}

/** Parse profile name from a Content-Disposition header value. Returns null if not found. */
export function getRemoteNameByContentDisposition(contentDisposition: string): string | null {
    const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
    const matches = filenameRegex.exec(contentDisposition);
    if (matches != null && matches[1]) {
        return decodeURIComponent(matches[1].replace(/['"]/g, ''));
    }
    return null;
}

/**
 * Fetch with automatic timeout via AbortController.
 * Default timeout: 10 seconds.
 * If the caller passes a signal in init, aborting either signal will cancel the request.
 */
export async function fetchWithTimeout(
    input: string,
    init?: RequestInit,
    timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    // If the caller provided a signal, forward its abort to our controller
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

