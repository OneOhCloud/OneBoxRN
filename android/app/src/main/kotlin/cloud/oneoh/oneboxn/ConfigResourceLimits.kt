package cloud.oneoh.oneboxn

import cloud.oneoh.oneboxn.core.ConfigMerge

/** 外部配置在下载与本地编译边界共用的资源上限。 */
internal object ConfigResourceLimits {
    /** 单一来源在 core `ConfigMerge`：合并入口持有该上限，抓取侧只是提前一步拒绝。 */
    const val MAX_IMPORTED_CONFIG_SIZE = ConfigMerge.MAX_IMPORTED_CONFIG_SIZE

    /** 同上转发，**不在这里重算倍数**：合并出口按 core 这一份判，交接件却按本地那一份拒，
     *  两份一旦分叉，合并放行的配置会撞死在 `TunnelConfigHandoff` 的 `require` 上。 */
    const val MAX_COMPILED_CONFIG_SIZE = ConfigMerge.MAX_COMPILED_CONFIG_SIZE
}
