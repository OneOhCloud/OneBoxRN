
import { getLocales } from 'expo-localization';
import { I18n } from 'i18n-js';

const translations = {
    en: {
        close: 'Close',
        welcome: 'Hello',
        camera_permission: 'Need your camera permission to scan QR code',
    },
    zh: {
        close: '关闭',
        welcome: '欢迎',
        camera_permission: '需要访问您的相机权限才能扫描二维码',
    },
};

const i18n = new I18n(translations);
i18n.locale = getLocales()[0].languageCode ?? 'en';
i18n.enableFallback = true;

export default i18n;