import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { getLocales } from 'expo-localization';
import { fetch } from 'expo/fetch';
import { Platform } from 'react-native';
import ExpoOneBox from './modules/expo-onebox';

const DEFAULT_TIMEOUT_MS = 10_000;

export interface SubInfo {
    used: number;
    total: number;
    expire: number;
}

function formatSignificant(n: number): string {
    if (n >= 100) return Math.round(n).toString();
    if (n >= 10) return n.toFixed(1).replace(/\.0$/, '');
    return n.toFixed(2).replace(/\.?0+$/, '');
}

export function fmtBytes(bytes: number): string {
    if (bytes <= 0) return '0 B';
    const KB = 1024;
    const MB = KB * 1024;
    const GB = MB * 1024;
    if (bytes < KB) return `${bytes} B`;
    if (bytes < MB) return `${formatSignificant(bytes / KB)} KB`;
    if (bytes < GB) return `${formatSignificant(bytes / MB)} MB`;
    return `${formatSignificant(bytes / GB)} GB`;
}

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

// URL / header name-derivation helpers live in utils/url-info.ts (pure core);
// re-exported here so existing call sites keep their import path.
export { deriveProfileNameFromUrl, getRemoteNameByContentDisposition, urlFilename, urlHostname } from './utils/url-info';

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
    if (Platform.OS === 'web') {
        const { buildMockConfigBody, buildMockUserinfoHeader } = await import('./modules/expo-onebox/src/ExpoOneBoxModule.web');
        return new Response(buildMockConfigBody(input), {
            status: 200,
            headers: {
                'content-type': 'application/json',
                'subscription-userinfo': buildMockUserinfoHeader(),
            },
        });
    }

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

