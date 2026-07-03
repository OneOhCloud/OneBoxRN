/**
 * 纯粹的版本路径解析器 —— 不引入原生模块、不用 expo-*、不用 react-native。
 *
 * Node（scripts/sync-templates.ts 经 --experimental-strip-types）与 React Native
 * 运行时（src/database/helper.ts）都能用，无需拉入原生桥接。
 */

export type SingBoxVersion = {
    major: string;
    minor: string;
    patch: number;
};

/**
 * 把裸版本字符串（例如 `"1.13.8"`）解析成各组成部分。
 * 输入格式错误（缺 patch、非数字、空串）时抛错。
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
 * 把解析后的版本映射到模板仓库里 `conf/<dir>/` 使用的路径段。规则：
 *   - 1.13.x  patch >= 8  →  "1.13.8"
 *   - 1.13.x  patch <  8  →  "1.13"
 *   - 1.12.x              →  "1.12"
 *   - 其它                →  抛错
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
 * 缓存某个模式配置模板所用的 KV key。
 *
 * app 版本是 key 的一部分，这样安装新构建会作废上一构建缓存的所有模板：
 * 缓存未命中，本次构建内置的模板成为下限，远程也会重新拉取。否则，一份在
 * 某个 route-rule 锚点（某条 route-rule tag）出现之前抓取的远程快照，
 * 可能在升级后仍然存活，并静默抹掉用户的自定义规则 —— `injectCustomRules`
 * 会跳过任何它找不到的锚点。
 *
 * sing-box 的 minor 也嵌进 key，使缓存在 core 的不同 minor 间重置。
 */
export function buildTemplateCacheKey(
    appVersion: string,
    singBoxMajor: string,
    mode: string,
): string {
    return `key-sing-box-${singBoxMajor}-app-${appVersion}-${mode}-template-config-cache`;
}
