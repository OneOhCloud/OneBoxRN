/**
 * Smoke-import 注册表 —— 每个运行时加载、且带原生侧的包在这里都有一条条目。
 *
 * 目的不是验证业务行为，而是在 dev 下 app 一启动就抓出"这个 import 假定了
 * Hermes+RN 并不提供的 Node/浏览器 API"，而非几天后用户走到功能路径才发现。
 * `crypto.subtle` 就是这类失败的典型例子。
 *
 * 约定：
 *   - `package.json` 里每个触及原生层的直接依赖（`expo-*`、`react-native-*`、
 *     `@/modules/*`）都需要一条条目。
 *   - 纯 JS 库（i18n-js、jsonc-parser …）不需要条目 —— 它们的失败模式是
 *     bundler / import 错误，在 app 启动时就已可见。
 *   - 检查不应改变可观察状态：
 *        ✗ `Haptics.selectionAsync()`（会震动设备）
 *        ✗ `Clipboard.setStringAsync('x')`（会覆盖用户剪贴板）
 *        ✓ `Clipboard.hasStringAsync()`（只读）
 *        ✓ 访问某个属性 getter
 *   - 检查只需证明 bridge 可达 —— 不对返回值做断言。只要调用 resolve，条目即通过。
 *   - 用动态 `await import(...)` 而非静态 import，好让 Node 侧的 `node --test`
 *     runner 在跑其它套件时永远不会尝试解析原生模块。
 *
 * 新增一条条目：
 *   1. 在下方 `SMOKE_IMPORT_ENTRIES` 里加一个对象，按 id 排序。
 *   2. 让 `run()` 体尽量小 —— 一次动态 import + 一次调用。
 *   3. 通过 `make run-ios` / `make run-android` 运行 app —— deep-link
 *      `oneoh-networktools://dev-smoke` 会自动触发，任何回归立即显示在面板上。
 */
import type { TestCase } from '@/debug/import-tests/runner';
import { expect } from '@/debug/import-tests/runner';

function smoke(id: string, name: string, run: (ctx: { log: (m: string) => void }) => Promise<void>): TestCase {
    return { id, name, group: 'smoke', run: async (ctx) => { await run(ctx); } };
}

export const SMOKE_IMPORT_ENTRIES: readonly TestCase[] = [
    // ── 自定义原生模块 ─────────────────────────────────────────────────
    smoke('module-expo-onebox', '@/modules/expo-onebox', async (ctx) => {
        const ExpoOneBox = (await import('@/modules/expo-onebox')).default;
        const status = ExpoOneBox.getStatus();
        ctx.log(`getStatus=${status}`);
        expect(typeof status === 'number', 'getStatus must return a number');
    }),

    // ── 崩溃上报（原生）─────────────────────────────────────────────
    smoke('bugsnag-expo', '@bugsnag/expo', async (ctx) => {
        const Bugsnag = (await import('@bugsnag/expo')).default;
        // 只读形状检查 —— 冒烟探针里绝不调用 start()/notify()。
        ctx.log(`notify is function=${typeof Bugsnag.notify === 'function'}`);
        expect(typeof Bugsnag.notify === 'function', 'Bugsnag.notify must exist');
    }),

    // ── Expo 原生模块 ──────────────────────────────────────────────────
    smoke('expo-application', 'expo-application', async (ctx) => {
        const Application = await import('expo-application');
        ctx.log(`nativeApplicationVersion=${Application.nativeApplicationVersion}`);
    }),

    smoke('expo-asset', 'expo-asset', async (ctx) => {
        const mod = await import('expo-asset');
        ctx.log(`Asset defined=${!!mod.Asset}`);
        expect(!!mod.Asset, 'Asset export must exist');
    }),

    smoke('expo-camera', 'expo-camera', async (ctx) => {
        const mod = await import('expo-camera');
        // `CameraView` 是标志性的运行时表面；证明模块已加载就够了 ——
        // 权限探测超出冒烟检查的范围。
        ctx.log(`CameraView defined=${!!mod.CameraView}`);
        expect(!!mod.CameraView, 'CameraView export must exist');
    }),

    smoke('expo-clipboard', 'expo-clipboard', async (ctx) => {
        const Clipboard = await import('expo-clipboard');
        // 只读 —— 冒烟检查里绝不调用 setStringAsync。
        const has = await Clipboard.hasStringAsync();
        ctx.log(`hasStringAsync=${has}`);
    }),

    smoke('expo-constants', 'expo-constants', async (ctx) => {
        const Constants = (await import('expo-constants')).default;
        ctx.log(`expoConfig?=${!!Constants.expoConfig}, name=${Constants.expoConfig?.name ?? '(none)'}`);
    }),

    smoke('expo-crypto', 'expo-crypto', async (ctx) => {
        const Crypto = await import('expo-crypto');
        const digest = await Crypto.digestStringAsync(
            Crypto.CryptoDigestAlgorithm.SHA256,
            'smoke-test',
            { encoding: Crypto.CryptoEncoding.HEX },
        );
        ctx.log(`digest(16)=${digest.slice(0, 16)}..., len=${digest.length}`);
        expect(digest.length === 64, 'SHA-256 hex must be 64 chars');
    }),

    smoke('expo-device', 'expo-device', async (ctx) => {
        const Device = await import('expo-device');
        ctx.log(`brand=${Device.brand ?? '(n/a)'}, model=${Device.modelName ?? '(n/a)'}`);
    }),

    smoke('expo-font', 'expo-font', async (ctx) => {
        const Font = await import('expo-font');
        const loaded = Font.isLoaded('smoke-nonexistent-font-key');
        ctx.log(`isLoaded('nonexistent')=${loaded}`);
    }),

    smoke('expo-haptics', 'expo-haptics', async (ctx) => {
        const mod = await import('expo-haptics');
        // 不要触发 —— 冒烟检查绝不能震动设备。
        const hasImpact = typeof mod.impactAsync === 'function';
        ctx.log(`impactAsync is function=${hasImpact}`);
        expect(hasImpact, 'impactAsync must be a function');
    }),

    smoke('expo-image', 'expo-image', async (ctx) => {
        const mod = await import('expo-image');
        ctx.log(`Image is defined=${!!mod.Image}`);
        expect(!!mod.Image, 'expected Image export');
    }),

    smoke('expo-linking', 'expo-linking', async (ctx) => {
        const Linking = await import('expo-linking');
        const url = Linking.createURL('/smoke');
        ctx.log(`createURL(/smoke)=${url}`);
        expect(typeof url === 'string' && url.length > 0, 'createURL must return non-empty string');
    }),

    smoke('expo-localization', 'expo-localization', async (ctx) => {
        const Localization = await import('expo-localization');
        const locales = Localization.getLocales();
        ctx.log(`locales.length=${locales.length}, first=${locales[0]?.languageTag ?? '(none)'}`);
    }),

    smoke('expo-notifications', 'expo-notifications', async (ctx) => {
        const Notifications = await import('expo-notifications');
        const perm = await Notifications.getPermissionsAsync();
        // 权限响应的形状在不同 Expo SDK 间会变化；直接 dump 整个对象而非读取
        // 具名字段，可让此条目在未来 SDK 升级时更稳健。
        ctx.log(`perm=${JSON.stringify(perm).slice(0, 120)}`);
        expect(typeof perm === 'object' && perm !== null, 'perm object must be returned');
    }),

    smoke('expo-router', 'expo-router', async (ctx) => {
        const mod = await import('expo-router');
        ctx.log(`router.push is function=${typeof mod.router.push === 'function'}`);
        expect(typeof mod.router.push === 'function', 'router.push must exist');
    }),

    smoke('expo-splash-screen', 'expo-splash-screen', async (ctx) => {
        const mod = await import('expo-splash-screen');
        // hideAsync 是幂等的，即便 splash 已隐藏也安全。
        // 但这里不调用它 —— 只检查形状。
        ctx.log(`hideAsync is function=${typeof mod.hideAsync === 'function'}`);
        expect(typeof mod.hideAsync === 'function', 'hideAsync must exist');
    }),

    smoke('expo-sqlite', 'expo-sqlite', async (ctx) => {
        const SQLite = await import('expo-sqlite');
        // 打开内存数据库 —— 不在磁盘上留下痕迹。
        const db = await SQLite.openDatabaseAsync(':memory:');
        await db.execAsync('SELECT 1');
        await db.closeAsync();
        ctx.log('in-memory SQLite open/select/close ok');
    }),

    smoke('expo-status-bar', 'expo-status-bar', async (ctx) => {
        const mod = await import('expo-status-bar');
        ctx.log(`StatusBar is defined=${!!mod.StatusBar}`);
        expect(!!mod.StatusBar, 'StatusBar export must exist');
    }),

    smoke('expo-system-ui', 'expo-system-ui', async (ctx) => {
        const SystemUI = await import('expo-system-ui');
        const bg = await SystemUI.getBackgroundColorAsync();
        // `ColorValue` 可能是 RN 的 symbol 不透明包装 —— 转成字符串，
        // 好让日志在各平台都可打印。
        ctx.log(`backgroundColor=${bg === null ? '(null)' : String(bg)}`);
    }),

    // ── React Native 附加组件（import 时都会自安装）────────────────────
    smoke('react-native-gesture-handler', 'react-native-gesture-handler', async (ctx) => {
        const mod = await import('react-native-gesture-handler');
        ctx.log(`GestureHandlerRootView defined=${!!mod.GestureHandlerRootView}`);
        expect(!!mod.GestureHandlerRootView, 'GestureHandlerRootView must exist');
    }),

    smoke('react-native-reanimated', 'react-native-reanimated', async (ctx) => {
        const mod = await import('react-native-reanimated');
        ctx.log(`default.View defined=${!!mod.default?.View}`);
        expect(!!mod.default?.View, 'Animated.View must exist');
    }),

    smoke('react-native-safe-area-context', 'react-native-safe-area-context', async (ctx) => {
        const mod = await import('react-native-safe-area-context');
        ctx.log(`SafeAreaProvider defined=${!!mod.SafeAreaProvider}`);
        expect(!!mod.SafeAreaProvider, 'SafeAreaProvider must exist');
    }),

    smoke('react-native-screens', 'react-native-screens', async (ctx) => {
        const mod = await import('react-native-screens');
        ctx.log(`enableScreens is function=${typeof mod.enableScreens === 'function'}`);
        expect(typeof mod.enableScreens === 'function', 'enableScreens must exist');
    }),

    smoke('react-native-svg', 'react-native-svg', async (ctx) => {
        const mod = await import('react-native-svg');
        ctx.log(`default (Svg) defined=${!!mod.default}`);
        expect(!!mod.default, 'Svg default export must exist');
    }),

    smoke('react-native-worklets', 'react-native-worklets', async (ctx) => {
        const mod = await import('react-native-worklets');
        ctx.log(`exports=${Object.keys(mod).slice(0, 6).join(',')}`);
        expect(Object.keys(mod).length > 0, 'module must export at least one symbol');
    }),

    // ── 重量级纯 JS UI 套件（import 时自安装 worklets/handlers）─────
    smoke('gorhom-bottom-sheet', '@gorhom/bottom-sheet', async (ctx) => {
        const mod = await import('@gorhom/bottom-sheet');
        ctx.log(`BottomSheetModal defined=${!!mod.BottomSheetModal}`);
        expect(!!mod.BottomSheetModal, 'BottomSheetModal must exist');
    }),

    smoke('expo-vector-icons', '@expo/vector-icons', async (ctx) => {
        const mod = await import('@expo/vector-icons');
        ctx.log(`Ionicons defined=${!!mod.Ionicons}`);
        expect(!!mod.Ionicons, 'Ionicons must exist');
    }),

    // ── 生产路径预期存在的 Hermes 全局 ──────────────────
    smoke('global-texts', 'globalThis: TextEncoder / atob / btoa / URL', async (ctx) => {
        expect(typeof TextEncoder === 'function', 'TextEncoder must exist');
        expect(typeof atob === 'function', 'atob must exist');
        expect(typeof btoa === 'function', 'btoa must exist');
        expect(typeof URL === 'function', 'URL must exist');
        // 冒烟测试实际行为 —— Hermes 有时会缺方法。
        const u = new URL('https://example.invalid/a/b?x=1');
        expect(u.searchParams.get('x') === '1', 'URL.searchParams must work');
        const round = atob(btoa('abc'));
        expect(round === 'abc', 'atob/btoa round-trip must hold');
        ctx.log('all globals present and functional');
    }),
];
