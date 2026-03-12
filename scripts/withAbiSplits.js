const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Expo config plugin to enable APK splitting by CPU architecture (ABI).
 *
 * Uses product flavors (AGP 8+ compatible) inside the android {} block:
 *   - arm32  → armeabi-v7a (32-bit ARM)
 *   - arm64  → arm64-v8a   (64-bit ARM)
 *
 * Each variant gets a unique versionCode:
 *   arm32 → 1_000_000 + original versionCode
 *   arm64 → 2_000_000 + original versionCode
 */
const withAbiSplits = (config, {} = {}) => {
  return withAppBuildGradle(config, (config) => {
    let gradle = config.modResults.contents;

    // Migration: remove old splits {} block injected by previous versions of this plugin
    if (gradle.includes('splits {')) {
      gradle = removeOldSplitsBlock(gradle);
      console.log('[withAbiSplits] Removed legacy splits {} block.');
    }

    // Avoid duplicate injection
    if (gradle.includes('"abiSplit"')) {
      console.log('[withAbiSplits] abiSplit flavors already present, skipping.');
      config.modResults.contents = gradle;
      return config;
    }

    const versionCode = config.android?.versionCode ?? 1;
    const flavorsBlock = `
    // ----- ABI Splits via product flavors (AGP 8+) -----
    flavorDimensions += "abiSplit"
    productFlavors {
        arm32 {
            dimension "abiSplit"
            ndk { abiFilters "armeabi-v7a" }
            versionCode ${1_000_000 + versionCode}
        }
        arm64 {
            dimension "abiSplit"
            ndk { abiFilters "arm64-v8a" }
            versionCode ${2_000_000 + versionCode}
        }
    }
    // --------------------------------------------------
`;

    // Insert inside the android { } block, before its closing brace
    const androidBlockEnd = findAndroidBlockEnd(gradle);
    if (androidBlockEnd === -1) {
      console.warn('[withAbiSplits] Could not locate end of android { } block. Skipping.');
      config.modResults.contents = gradle;
      return config;
    }

    config.modResults.contents =
      gradle.slice(0, androidBlockEnd) +
      flavorsBlock +
      gradle.slice(androidBlockEnd);

    console.log('[withAbiSplits] ✅ ABI splits (product flavors) configured for AGP 8+.');
    return config;
  });
};

/**
 * Remove the legacy splits {} block (and its accompanying versionCodeOverride logic)
 * that was injected by older versions of this plugin.
 */
function removeOldSplitsBlock(gradle) {
  const startMarker = '\n// ----- ABI Splits: generate one APK per CPU architecture -----';
  const endMarker = '// --------------------------------------------------------------';
  const start = gradle.indexOf(startMarker);
  if (start === -1) return gradle;
  const endIdx = gradle.indexOf(endMarker, start);
  if (endIdx === -1) return gradle;
  return gradle.slice(0, start) + gradle.slice(endIdx + endMarker.length);
}

/**
 * Find the index of the closing `}` of the top-level `android { }` block.
 * Uses a simple brace-depth counter after the `android {` marker.
 */
function findAndroidBlockEnd(gradle) {
  const start = gradle.indexOf('\nandroid {');
  if (start === -1) return -1;

  let depth = 0;
  for (let i = start; i < gradle.length; i++) {
    if (gradle[i] === '{') depth++;
    else if (gradle[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

module.exports = withAbiSplits;
