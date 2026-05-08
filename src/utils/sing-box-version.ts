/**
 * Single runtime source for the sing-box version.
 *
 * `ExpoOneBox.getLibBoxVersion()` is the authoritative accessor — it
 * returns whatever Libbox was compiled with (driven by SING_BOX_TAG in
 * src/modules/expo-onebox/helper/Makefile, which the gomobile build
 * bakes into the binary). Keeping a parallel hand-maintained constant
 * in `definition.ts` only invites drift; always call these helpers
 * instead.
 *
 * Output shape is `v<MAJOR>.<MINOR>.<PATCH>` (matching native), so
 * `startsWith('v1.12')` / `startsWith('v1.13')` style checks keep
 * working against historical code.
 */

import ExpoOneBox from '@/modules/expo-onebox';

/**
 * Bare `MAJOR.MINOR.PATCH` version reported by the linked Libbox.
 * The native accessor does NOT prefix with `v` — callers that want
 * display form (e.g. `v1.13.8-<commit>`) should prepend it themselves.
 * Returns `'0.0.0'` as a safe floor when the native module is offline
 * (keeps downstream split calls total).
 */
export function getSingBoxVersion(): string {
    return ExpoOneBox.getLibBoxVersion() || '0.0.0';
}

/**
 * `MAJOR.MINOR` of the running Libbox — e.g. `"1.13"` for `1.13.8`.
 * Used as a cache-key segment so config caches survive within a
 * sing-box minor line but reset across minors.
 */
export function getSingBoxMajorVersion(): string {
    const [major = '0', minor = '0'] = getSingBoxVersion().split('.');
    return `${major}.${minor}`;
}

/**
 * Patch component — e.g. `"8"` for `1.13.8`. Used by the template URL
 * resolver to pick `conf/1.13.8/` once the sing-box patch reaches 8+.
 */
export function getSingBoxPatchVersion(): string {
    return getSingBoxVersion().split('.')[2] ?? '0';
}
