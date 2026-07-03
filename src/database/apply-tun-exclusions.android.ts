import { mergeUserTunField, type TunConfigLike } from './tun-exclusions';

/**
 * Android：把配置文件的 `exclude_package`（绕过隧道的 app）从导入的配置带入
 * 当前生效的配置。按平台拆分的理由见基础文件 `apply-tun-exclusions.ts`。
 */
export function applyPlatformTunExclusions(
    userConfig: TunConfigLike,
    templateConfig: TunConfigLike,
): void {
    mergeUserTunField(userConfig, templateConfig, 'exclude_package');
}
