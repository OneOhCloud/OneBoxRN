import type { ConfigContext, ExpoConfig } from 'expo/config';

const { readFileSync } = require('node:fs') as typeof import('node:fs');
const { join } = require('node:path') as typeof import('node:path');

type VersionJson = {
  version: string;
};

const versionJson = JSON.parse(readFileSync(join(__dirname, 'version.json'), 'utf8')) as VersionJson;

/**
 * 动态 Expo 配置。
 *
 * 版本号唯一来源为 version.json。
 *
 * 构建期从 .env 读取的环境变量：
 *   accelerateUrl  – 配置 URL 加速代理的 base URL。
 *                    在 .env 中填写即可为远程配置启用回落加载。
 *                    示例：accelerateUrl=https://your-accelerator-host.example.com
 *                    留空或不填则完全关闭加速。
 */
export default ({ config: _config }: ConfigContext): ExpoConfig => ({
  name: 'OneBoxM',
  slug: 'oneoh-networktools-app',
  version: versionJson.version,
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'oneoh-networktools',
  userInterfaceStyle: 'automatic',
  ios: {
    buildNumber: '19',
    supportsTablet: true,
    bundleIdentifier: 'cloud.oneoh.networktools',
    entitlements: {
      'com.apple.developer.networking.networkextension': [
        'packet-tunnel-provider',
        'app-proxy-provider',
        'content-filter-provider',
      ],
      'com.apple.developer.networking.vpn.api': ['allow-vpn'],
      'com.apple.security.application-groups': ['group.cloud.oneoh.networktools'],
    },
    infoPlist: {
      UIBackgroundModes: ['fetch', 'processing'],
      BGTaskSchedulerPermittedIdentifiers: ['cloud.oneoh.networktools.config-refresh'],
      ITSAppUsesNonExemptEncryption: false,
      CFBundleLocalizations: ['en', 'zh'],
    },
  },
  android: {
    versionCode: 19,
    adaptiveIcon: {
      foregroundImage: './assets/images/adaptive.png',
      backgroundColor: '#0091FF',
    },
    package: 'cloud.oneoh.networktools',
    permissions: [
      'VPN_PERMISSION_REQUIRED',
      'android.permission.VIBRATE',
      'android.permission.WAKE_LOCK',
      'android.permission.RECEIVE_BOOT_COMPLETED',
      'android.permission.CAMERA',
      'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
    ],
  },
  web: {
    output: 'static',
  },
  plugins: [
    'expo-router',
    [
      'expo-localization',
      {
        supportedLocales: {
          ios: ['en', 'zh'],
          android: ['en', 'zh'],
        },
      },
    ],
    [
      'expo-camera',
      {
        cameraPermission:
          'To scan QR codes for importing profile config URLs and managing network configurations.',
        // 仅扫码，App 全程不采集音视频。
        // false 会移除 NSMicrophoneUsageDescription 与 Android RECORD_AUDIO。
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
    [
      'expo-build-properties',
      {
        ios: {
          appleTeamId: 'GN2W3N34TM',
          infoPlist: {
            NSContactsUsageDescription: null,
            NSMicrophoneUsageDescription: null,
          },
        },
        android: {
          buildArchs: ['armeabi-v7a', 'arm64-v8a'],
          useDayNightTheme: true,
          useLegacyPackaging: true,
          enableBundleCompression: true,
          enableMinifyInReleaseBuilds: true,
          enablePngCrunchInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
        },
      },
    ],
    [
      'expo-splash-screen',
      {
        image: './assets/images/adaptive.png',
        imageWidth: 200,
        imageHeight: 200,
        resizeMode: 'contain',
        backgroundColor: '#0091FF',
        dark: {
          backgroundColor: '#000000',
        },
      },
    ],
    [
      'expo-sqlite',
      {
        enableFTS: true,
        useSQLCipher: true,
        android: {
          enableFTS: true,
          useSQLCipher: true,
        },
        ios: {
          customBuildFlags: ['-DSQLITE_ENABLE_DBSTAT_VTAB=1 -DSQLITE_ENABLE_SNAPSHOT=1'],
        },
      },
    ],
    './scripts/withOneBoxMTunnel.js',
    './scripts/withGradleBuildOptimization.js',
    './scripts/withAndroidStatusBar.js',
    './scripts/withReleaseSigningConfig.js',
    './scripts/withFmtFix.js',
    'expo-status-bar',
    'expo-localization',
    'expo-image',
    'expo-font',
    'expo-secure-store',
  ],
  experiments: {
    autolinkingModuleResolution: true,
    typedRoutes: true,
  },
  extra: {
    router: {},
    eas: {
      projectId: 'a705f7ba-e090-4f16-a842-31f0cd5c0e89',
    },
    bugsnag: {
      apiKey: process.env.BUGSNAG_API_KEY || null,
    },
    // 构建期从 .env 读取；null 表示关闭加速。
    accelerateUrl: process.env.accelerateUrl || null,
  },
  owner: 'oneoh-cloud-llc',
});
