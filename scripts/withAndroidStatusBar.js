const { withAndroidStyles, withDangerousMod } = require('@expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Expo Config Plugin：Android 状态栏图标颜色。
 *
 * 设置 windowLightStatusBar，确保状态栏图标始终清晰可读：
 *   - 浅色模式 → true  （白底上的深色/黑色图标）
 *   - 深色模式 → false （深底上的浅色/白色图标）
 *
 * values/styles.xml 与 values-night/styles.xml 都会写入，因此从第一帧
 * （JS 加载之前）起图标颜色就正确。
 */

const STYLE_NAME = 'AppTheme';
const ITEM_NAME = 'android:windowLightStatusBar';

/** 在解析后的 styles XML 对象里，向指定 <style> 中 upsert 一个 <item>。 */
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

/** 写入 values-night/styles.xml，让深色模式也拿到正确设置。 */
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

  // 内容变化时才写入 —— 避免不必要的 prebuild 抖动。
  const existing = fs.existsSync(nightStylesPath)
    ? fs.readFileSync(nightStylesPath, 'utf-8')
    : '';
  if (existing !== content) {
    fs.writeFileSync(nightStylesPath, content, 'utf-8');
  }
}

const withAndroidStatusBar = (config) => {
  // 第 1 步：patch values/styles.xml（浅色模式 —— windowLightStatusBar = true）
  config = withAndroidStyles(config, (modConfig) => {
    upsertStyleItem(modConfig.modResults, STYLE_NAME, ITEM_NAME, 'true');
    return modConfig;
  });

  // 第 2 步：写入 values-night/styles.xml（深色模式 —— windowLightStatusBar = false）
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
