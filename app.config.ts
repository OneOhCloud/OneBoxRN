import type { ConfigContext, ExpoConfig } from 'expo/config';
import appJson from './app.json';
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
    ...(appJson.expo as ExpoConfig),
    version: versionJson.version,
    extra: {
        ...appJson.expo.extra,
        // Loaded from .env at build time; null → acceleration disabled.
        accelerateUrl: process.env.accelerateUrl || null,
    },
});
