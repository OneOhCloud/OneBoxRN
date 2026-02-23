import { getLocales } from 'expo-localization';
import { Platform } from 'react-native';
import { SING_BOX_VERSION } from './definition';

// SFM/1.3.4 (macos aarch64 26.3.0; sing-box 1.13.0-rc.5; language zh-Hans-CN)
const iOSTag = 'SFI';
const AndroidTag = 'SFA';

export function getSingBoxUserAgent(): string {
    const platform = Platform.OS;
    const platformVersion = Platform.Version;
    const locales = getLocales();
    const language = locales && locales.length > 0 ? locales[0].languageTag : 'zh-Hans-CN';
    if (platform === 'ios') {
        return `${iOSTag}/${platform} ${platformVersion}; sing-box ${SING_BOX_VERSION}; language ${language}`;
    } else if (platform === 'android') {
        return `${AndroidTag}/${platform} ${platformVersion}; sing-box ${SING_BOX_VERSION}; language ${language}`;
    } else {
        throw new Error(`Unsupported platform: ${platform}`);
    }

}