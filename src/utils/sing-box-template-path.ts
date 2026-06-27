/**
 * Pure version-path resolver — no native imports, no expo-*, no react-native.
 *
 * Usable from both Node (scripts/sync-templates.ts via --experimental-strip-types)
 * and React Native runtime (src/database/helper.ts) without pulling in the
 * native bridge.
 */

export type SingBoxVersion = {
    major: string;
    minor: string;
    patch: number;
};

/**
 * Parse a bare version string (e.g. `"1.13.8"`) into its components.
 * Throws on malformed input (missing patch, non-numeric, empty string).
 */
export function parseSingBoxVersion(bare: string): SingBoxVersion {
    if (!bare) throw new Error(`parseSingBoxVersion: empty version string`);
    const parts = bare.split('.');
    if (parts.length < 3) {
        throw new Error(`parseSingBoxVersion: expected MAJOR.MINOR.PATCH, got "${bare}"`);
    }
    const [major, minor, patchStr] = parts;
    const patch = parseInt(patchStr!, 10);
    if (!major || !minor || Number.isNaN(patch)) {
        throw new Error(`parseSingBoxVersion: malformed version "${bare}"`);
    }
    return { major, minor, patch };
}

/**
 * Map a parsed version to the `conf/<dir>/` path segment used in the
 * template repo. Rules:
 *   - 1.13.x  patch >= 8  →  "1.13.8"
 *   - 1.13.x  patch <  8  →  "1.13"
 *   - 1.12.x              →  "1.12"
 *   - anything else       →  throws
 */
export function resolveVersionPath(v: SingBoxVersion): string {
    if (v.major === '1' && v.minor === '13' && v.patch >= 8) return '1.13.8';
    if (v.major === '1' && v.minor === '13') return '1.13';
    if (v.major === '1' && v.minor === '12') return '1.12';
    throw new Error(
        `Unsupported sing-box version ${v.major}.${v.minor}.${v.patch}`,
    );
}

/**
 * KV key under which a per-mode config template is cached.
 *
 * The app version is part of the key so that installing a new app build
 * abandons every template the previous build cached: the cache misses, the
 * template shipped inside this build becomes the floor, and the remote is
 * refetched fresh. Without this, a remote snapshot taken before a route-rule
 * anchor (e.g. `reject-tag.oneoh.cloud`) existed could survive the upgrade and
 * silently strip the user's custom rules — `injectCustomRules` skips any
 * anchor it cannot find.
 *
 * The sing-box minor is also embedded so caches reset across core minors.
 */
export function buildTemplateCacheKey(
    appVersion: string,
    singBoxMajor: string,
    mode: string,
): string {
    return `key-sing-box-${singBoxMajor}-app-${appVersion}-${mode}-template-config-cache`;
}
