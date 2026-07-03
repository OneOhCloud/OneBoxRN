/**
 * Single runtime source for the sing-box version.
 *
 * `ExpoOneBox.getLibBoxVersion()` is the authoritative accessor — it
 * returns whatever Libbox was compiled with (driven by SING_BOX_TAG in
 * src/modules/expo-onebox/helper/Makefile, which the gomobile build
 * bakes into the binary). Always call these helpers rather than
 * hand-maintaining a parallel version constant, which only invites drift.
 *
 * Output is bare `MAJOR.MINOR.PATCH` (no `v` prefix), matching the native
 * accessor — callers comparing against literals must not include a `v`.
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
