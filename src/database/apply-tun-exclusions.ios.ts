import { mergeUserTunField, type TunConfigLike } from './tun-exclusions';

/**
 * iOS：NetworkExtension 没有 package 概念，因此改为把配置文件的
 * `route_exclude_address`（从路由范围内排除的 CIDR）从导入的配置带入当前生效
 * 的配置。合并在模板自带的私有网段排除项之上。按平台拆分的理由见基础文件
 * `apply-tun-exclusions.ts`。
 */
export function applyPlatformTunExclusions(
    userConfig: TunConfigLike,
    templateConfig: TunConfigLike,
): void {
    mergeUserTunField(userConfig, templateConfig, 'route_exclude_address');
}
