const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Expo Config Plugin: inject Android release signing config into build.gradle during prebuild.
 * Reads ANDROID_KEYSTORE_PATH / ANDROID_STORE_PASSWORD / ANDROID_KEY_ALIAS / ANDROID_KEY_PASSWORD
 * from Gradle properties (passed via -P flags by the Makefile).
 */
module.exports = function withReleaseSigningConfig(config) {
  return withAppBuildGradle(config, (config) => {
    let contents = config.modResults.contents;

    // Idempotent: skip if already patched
    if (contents.includes('ANDROID_KEYSTORE_PATH')) {
      return config;
    }

    // 1. Insert release signing block after the debug signing block
    contents = contents.replace(
      /(signingConfigs\s*\{)([\s\S]*?)(^\s*debug\s*\{[\s\S]*?^\s*\})/m,
      (match) =>
        match +
        `
        release {
            def keystorePath = findProperty('ANDROID_KEYSTORE_PATH') ?: System.getenv('ANDROID_KEYSTORE_PATH')
            if (keystorePath) {
                storeFile file(keystorePath)
                storePassword findProperty('ANDROID_STORE_PASSWORD') ?: System.getenv('ANDROID_STORE_PASSWORD')
                keyAlias findProperty('ANDROID_KEY_ALIAS') ?: System.getenv('ANDROID_KEY_ALIAS')
                keyPassword findProperty('ANDROID_KEY_PASSWORD') ?: System.getenv('ANDROID_KEY_PASSWORD')
            }
        }`
    );

    // 2. Replace release buildType to use release signingConfig
    contents = contents.replace(
      /(\bbuildTypes\s*\{[\s\S]*?\brelease\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/,
      (match, prefix) =>
        prefix +
        "def keystorePath = findProperty('ANDROID_KEYSTORE_PATH') ?: System.getenv('ANDROID_KEYSTORE_PATH')\n            signingConfig keystorePath ? signingConfigs.release : signingConfigs.debug"
    );

    config.modResults.contents = contents;
    return config;
  });
};
