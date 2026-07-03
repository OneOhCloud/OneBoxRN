import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { getLocales } from 'expo-localization';
import { Platform } from 'react-native';
import { getSingBoxVersion } from './sing-box-version';

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

    const preSuffix = platform === 'android' ? AndroidTag : iOSTag;
    const ua = `${preSuffix}/${version}`;
    const deviceInfo = `${platform} ${cpuArchs} ${Platform.Version}`;
    return `${ua} (${deviceInfo}; sing-box ${singboxVersion}; language ${language})`;
}
