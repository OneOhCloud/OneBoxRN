const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Expo config plugin to enable APK splitting by CPU architecture (ABI).
 *
 * Adds `splits { abi { ... } }` to android/app/build.gradle so that
 * Android Studio (or any Gradle build) produces a separate APK per ABI:
 *   - armeabi-v7a  (32-bit ARM)
 *   - arm64-v8a    (64-bit ARM)
 *
 * Each APK gets a unique versionCode:
 *   armeabi-v7a → 1_000_000 + original versionCode
 *   arm64-v8a   → 2_000_000 + original versionCode
 *
 * Set universalApk = true if you also want a combined "fat" APK.
 */
const withAbiSplits = (config, { universalApk = false } = {}) => {
  return withAppBuildGradle(config, (config) => {
    const gradle = config.modResults.contents;

    // Avoid duplicate injection
    if (gradle.includes('splits {')) {
      console.log('[withAbiSplits] splits block already present, skipping.');
      return config;
    }

    const splitsBlock = `
// ----- ABI Splits: generate one APK per CPU architecture -----
splits {
    abi {
        reset()
        enable true
        universalApk ${universalApk}
        include "armeabi-v7a", "arm64-v8a"
    }
}

// Assign unique versionCode per ABI so stores can distribute the right APK.
// armeabi-v7a → 1_000_000 + versionCode
// arm64-v8a   → 2_000_000 + versionCode
def abiVersionCodes = ['armeabi-v7a': 1, 'arm64-v8a': 2]
android.applicationVariants.all { variant ->
    variant.outputs.each { output ->
        def abiFilter = output.getFilter(com.android.build.OutputFile.ABI)
        def abiCode = abiVersionCodes.get(abiFilter)
        if (abiCode != null) {
            output.versionCodeOverride = abiCode * 1_000_000 + variant.versionCode
        }
    }
}
// --------------------------------------------------------------
`;

    // Insert the splits block right after the closing brace of the android { } block.
    // We locate the last `}` that closes `android {`.
    const androidBlockEnd = findAndroidBlockEnd(gradle);
    if (androidBlockEnd === -1) {
      console.warn('[withAbiSplits] Could not locate end of android { } block. Appending at end of file.');
      config.modResults.contents = gradle + splitsBlock;
    } else {
      config.modResults.contents =
        gradle.slice(0, androidBlockEnd + 1) +
        '\n' +
        splitsBlock +
        gradle.slice(androidBlockEnd + 1);
    }

    console.log('[withAbiSplits] ✅ ABI splits configured.');
    return config;
  });
};

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
