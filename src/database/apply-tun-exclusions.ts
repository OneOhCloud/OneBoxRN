import type { TunConfigLike } from './tun-exclusions';

/**
 * 就地把用户配置文件的 TUN 绕行字段合并进当前生效的配置。
 *
 * 按平台拆分（`.android.ts` / `.ios.ts` / 基础文件）：哪个 `tun` inbound 字段
 * 承载绕行列表因平台而异 ——
 *   Android → exclude_package，iOS → route_exclude_address。
 * 此基础实现服务于 Web，而 Web 永不构建 TUN 配置，故刻意做成空操作。按项目
 * 规则，平台差异放在平台文件里，而非在共享逻辑中用运行时 `Platform.OS` 分支。
 */
export function applyPlatformTunExclusions(
    _userConfig: TunConfigLike,
    _templateConfig: TunConfigLike,
): void {
    // Web 上为空操作
}
