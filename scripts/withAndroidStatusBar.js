const { withAndroidStyles, withDangerousMod } = require('@expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Expo Config Plugin: Android status bar icon color.
 *
 * Sets windowLightStatusBar so status bar icons are always readable:
 *   - Light mode → true  (dark/black icons on white background)
 *   - Dark mode  → false (light/white icons on dark background)
 *
 * Both values/styles.xml and values-night/styles.xml are written, so
 * the correct icon color applies from the first frame (before JS loads).
 */

const STYLE_NAME = 'AppTheme';
const ITEM_NAME = 'android:windowLightStatusBar';

/** Upsert a <item> inside the named <style> in the parsed styles XML object. */
function upsertStyleItem(resources, styleName, itemName, itemValue) {
  const styles = resources.resources?.style;
  if (!Array.isArray(styles)) return;

  const style = styles.find((s) => s.$?.name === styleName);
  if (!style) return;

  if (!Array.isArray(style.item)) {
    style.item = [];
  }

  const existing = style.item.find((i) => i.$?.name === itemName);
  if (existing) {
    existing._ = itemValue;
  } else {
    style.item.push({ $: { name: itemName }, _: itemValue });
  }
}

/** Write values-night/styles.xml so dark mode also gets the right setting. */
function writeNightStyles(platformProjectRoot) {
  const nightDir = path.join(platformProjectRoot, 'app/src/main/res/values-night');
  const nightStylesPath = path.join(nightDir, 'styles.xml');

  fs.mkdirSync(nightDir, { recursive: true });

  const content = `<resources>
  <style name="${STYLE_NAME}" parent="Theme.AppCompat.DayNight.NoActionBar">
    <item name="android:editTextBackground">@drawable/rn_edit_text_material</item>
    <item name="colorPrimary">@color/colorPrimary</item>
    <item name="android:statusBarColor">@android:color/transparent</item>
    <item name="android:navigationBarColor">@android:color/transparent</item>
    <item name="${ITEM_NAME}">false</item>
  </style>
</resources>
`;

  // Only write if the content changed — avoids unnecessary prebuild churn.
  const existing = fs.existsSync(nightStylesPath)
    ? fs.readFileSync(nightStylesPath, 'utf-8')
    : '';
  if (existing !== content) {
    fs.writeFileSync(nightStylesPath, content, 'utf-8');
  }
}

const withAndroidStatusBar = (config) => {
  // Step 1: patch values/styles.xml (light mode — windowLightStatusBar = true)
  config = withAndroidStyles(config, (modConfig) => {
    upsertStyleItem(modConfig.modResults, STYLE_NAME, ITEM_NAME, 'true');
    return modConfig;
  });

  // Step 2: write values-night/styles.xml (dark mode — windowLightStatusBar = false)
  config = withDangerousMod(config, [
    'android',
    (modConfig) => {
      writeNightStyles(modConfig.modRequest.platformProjectRoot);
      return modConfig;
    },
  ]);

  return config;
};

module.exports = withAndroidStatusBar;
