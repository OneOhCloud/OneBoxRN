import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { getLocales } from 'expo-localization';
import { fetch } from 'expo/fetch';
import { Platform } from 'react-native';
import { getSingBoxVersion } from './utils/sing-box-version';

const DEFAULT_TIMEOUT_MS = 10_000;

export interface ProfileQuota {
    used: number;
    total: number;
    expire: number;
}

// SFI / SFA impersonate the official sing-box client User-Agent tags
// (sing-box-for-iOS / sing-box-for-Android). Some config providers gate
// responses on this UA, so these strings are an external contract — changing
// them can break config delivery server-side.
const iOSTag = 'SFI';
const AndroidTag = 'SFA';

export function getSingBoxUserAgent(): string {
    const version = Constants.expoConfig?.version || 'unknown';

    const platform = Platform.OS;

    const cpuArchs = Device?.supportedCpuArchitectures?.[0] || 'unknown';
    const singboxVersion = getSingBoxVersion();
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

// deriveProfileNameFromUrl lives in utils/url-info.ts (pure core); re-exported
// here so its remaining '@/utils' call site keeps its import path. The sibling
// url-info helpers are imported from that module directly by their call sites.
export { deriveProfileNameFromUrl } from './utils/url-info';

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

