const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Expo Config Plugin：prebuild 期间把 Android release 签名配置注入 build.gradle。
 * 从 Gradle properties 读取 ANDROID_KEYSTORE_PATH / ANDROID_STORE_PASSWORD /
 * ANDROID_KEY_ALIAS / ANDROID_KEY_PASSWORD（由 Makefile 通过 -P 标志传入）。
 */
module.exports = function withReleaseSigningConfig(config) {
  return withAppBuildGradle(config, (config) => {
    let contents = config.modResults.contents;

    // 幂等：已 patch 过则跳过
    if (contents.includes('ANDROID_KEYSTORE_PATH')) {
      return config;
    }

    // 1. 在 debug 签名块之后插入 release 签名块
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

    // 2. 让 release buildType 改用 release signingConfig
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
