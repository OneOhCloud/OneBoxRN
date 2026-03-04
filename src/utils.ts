import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { getLocales } from 'expo-localization';
import { Platform } from 'react-native';
import ExpoOneBox from './modules/expo-onebox';


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

