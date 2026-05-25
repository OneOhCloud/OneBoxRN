import type { ConfigContext, ExpoConfig } from 'expo/config';
import versionJson from './version.json';

/**
 * Dynamic Expo config.
 *
 * Version is the single source of truth from version.json.
 *
 * Build-time env var loaded from .env:
 *   accelerateUrl  – base URL of the subscription accelerator proxy.
 *                    Add to .env to enable fallback loading for subscriptions.
 *                    Example: accelerateUrl=https://your-accelerator-host.example.com
 *                    Omit or leave blank to disable acceleration entirely.
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
      'android.permission.RECORD_AUDIO',
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
          'To scan QR codes for importing subscription links and managing network configurations.',
        recordAudioAndroid: true,
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
    'expo-web-browser',
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
    // Loaded from .env at build time; null → acceleration disabled.
    accelerateUrl: process.env.accelerateUrl || null,
  },
  owner: 'oneoh-cloud-llc',
});
