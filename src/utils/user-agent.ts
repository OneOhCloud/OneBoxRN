import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { getLocales } from 'expo-localization';
import { Platform } from 'react-native';
import { getSingBoxVersion } from './sing-box-version';

// SFI / SFA 冒充官方 sing-box 客户端的 User-Agent 标记
// （sing-box-for-iOS / sing-box-for-Android）。有些配置提供方会按此 UA 决定
// 是否返回响应，因此这些字符串是对外契约 —— 改动它们可能导致服务端不再下发配置。
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
