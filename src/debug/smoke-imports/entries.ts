/**
 * Smoke-import registry — every runtime-loaded package with a native
 * side has one entry here.
 *
 * The intent is NOT to verify business behaviour, it is to catch
 * "this import assumes a Node/browser API that Hermes+RN does not
 * provide" the instant the app starts in dev, instead of days later
 * when a user hits the feature path. Today's `crypto.subtle` hit is
 * the canonical example.
 *
 * Conventions:
 *   - Every direct dependency in `package.json` that reaches the
 *     native layer (`expo-*`, `react-native-*`, `@/modules/*`) needs
 *     one entry.
 *   - Pure-JS libs (i18n-js, tailwind-merge, jsonc-parser …) do NOT
 *     need entries — their failure mode is a bundler / import error
 *     that is already visible at app launch.
 *   - The check should NOT mutate observable state:
 *        ✗ `Haptics.selectionAsync()` (vibrates the device)
 *        ✗ `Clipboard.setStringAsync('x')` (clobbers the user clipboard)
 *        ✓ `Clipboard.hasStringAsync()` (read-only)
 *        ✓ accessing a property getter
 *   - The check need only prove the bridge is reachable — return
 *     value is NOT asserted. If the call resolves, entry passes.
 *   - Dynamic `await import(...)` instead of static imports so the
 *     Node-side `node --test` runner never tries to resolve native
 *     modules when the other suites run.
 *
 * Adding a new entry:
 *   1. Add an object to `SMOKE_IMPORT_ENTRIES` below, sorted by id.
 *   2. Make the `run()` body tiny — one dynamic import + one call.
 *   3. Run the app via `make run-ios` / `make run-android` — the
 *      deep-link `oneoh-networktools://dev-smoke` auto-fires and
 *      any regression shows in the panel immediately.
 */
import type { TestCase } from '@/debug/import-tests/runner';
import { expect } from '@/debug/import-tests/runner';

function smoke(id: string, name: string, run: (ctx: { log: (m: string) => void }) => Promise<void>): TestCase {
    return { id, name, group: 'import', run: async (ctx) => { await run(ctx); } };
}

export const SMOKE_IMPORT_ENTRIES: readonly TestCase[] = [
    // ── Custom native module ─────────────────────────────────────────────────
    smoke('module-expo-onebox', '@/modules/expo-onebox', async (ctx) => {
        const ExpoOneBox = (await import('@/modules/expo-onebox')).default;
        const status = ExpoOneBox.getStatus();
        ctx.log(`getStatus=${status}`);
        expect(typeof status === 'number', 'getStatus must return a number');
    }),

    // ── Expo native modules ──────────────────────────────────────────────────
    smoke('expo-application', 'expo-application', async (ctx) => {
        const Application = await import('expo-application');
        ctx.log(`nativeApplicationVersion=${Application.nativeApplicationVersion}`);
    }),

    smoke('expo-camera', 'expo-camera', async (ctx) => {
        const mod = await import('expo-camera');
        // `CameraView` is the canonical runtime surface; proving the
        // module loaded is enough — a permission probe is out of
        // scope for a smoke check.
        ctx.log(`CameraView defined=${!!mod.CameraView}`);
        expect(!!mod.CameraView, 'CameraView export must exist');
    }),

    smoke('expo-clipboard', 'expo-clipboard', async (ctx) => {
        const Clipboard = await import('expo-clipboard');
        // Read-only — never call setStringAsync in a smoke check.
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

    smoke('expo-glass-effect', 'expo-glass-effect', async (ctx) => {
        const mod = await import('expo-glass-effect');
        ctx.log(`exports=${Object.keys(mod).slice(0, 6).join(',')}`);
        expect(Object.keys(mod).length > 0, 'module must export at least one symbol');
    }),

    smoke('expo-haptics', 'expo-haptics', async (ctx) => {
        const mod = await import('expo-haptics');
        // Do NOT fire — a smoke check must not buzz the device.
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
        // Permission-response shape varies across Expo SDKs; dumping
        // the object rather than reading a named field keeps the entry
        // resilient to future SDK upgrades.
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
        // hideAsync is idempotent and safe if splash is already hidden.
        // Not invoking it here though — just checking shape.
        ctx.log(`hideAsync is function=${typeof mod.hideAsync === 'function'}`);
        expect(typeof mod.hideAsync === 'function', 'hideAsync must exist');
    }),

    smoke('expo-sqlite', 'expo-sqlite', async (ctx) => {
        const SQLite = await import('expo-sqlite');
        // Open an in-memory DB — leaves no trace on disk.
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

    smoke('expo-symbols', 'expo-symbols', async (ctx) => {
        const mod = await import('expo-symbols');
        ctx.log(`exports=${Object.keys(mod).slice(0, 6).join(',')}`);
        expect(Object.keys(mod).length > 0, 'module must export at least one symbol');
    }),

    smoke('expo-system-ui', 'expo-system-ui', async (ctx) => {
        const SystemUI = await import('expo-system-ui');
        const bg = await SystemUI.getBackgroundColorAsync();
        // `ColorValue` may be a RN symbol opaque wrapper — stringify
        // so the log stays printable across platforms.
        ctx.log(`backgroundColor=${bg === null ? '(null)' : String(bg)}`);
    }),

    smoke('expo-web-browser', 'expo-web-browser', async (ctx) => {
        const WebBrowser = await import('expo-web-browser');
        // maybeCompleteAuthSession is always safe — returns early when there is no pending session.
        const result = WebBrowser.maybeCompleteAuthSession();
        ctx.log(`maybeCompleteAuthSession.type=${result.type}`);
    }),

    // ── React Native add-ons (all self-install on import) ────────────────────
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

    smoke('react-native-nitro-modules', 'react-native-nitro-modules', async (ctx) => {
        const mod = await import('react-native-nitro-modules');
        ctx.log(`NitroModules defined=${!!mod.NitroModules}`);
        expect(!!mod.NitroModules, 'NitroModules runtime must exist');
    }),

    // ── Heavy pure-JS UI kits (self-install worklets/handlers on import) ─────
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

    // ── Hermes globals the production path expects to exist ──────────────────
    smoke('global-texts', 'globalThis: TextEncoder / atob / btoa / URL', async (ctx) => {
        expect(typeof TextEncoder === 'function', 'TextEncoder must exist');
        expect(typeof atob === 'function', 'atob must exist');
        expect(typeof btoa === 'function', 'btoa must exist');
        expect(typeof URL === 'function', 'URL must exist');
        // Smoke the actual behaviours — Hermes has historically missed methods.
        const u = new URL('https://example.invalid/a/b?x=1');
        expect(u.searchParams.get('x') === '1', 'URL.searchParams must work');
        const round = atob(btoa('abc'));
        expect(round === 'abc', 'atob/btoa round-trip must hold');
        ctx.log('all globals present and functional');
    }),
];
