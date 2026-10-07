/// 按需连接与全局接管的联动判据。
///
/// `includeAllNetworks` 是 Apple 的 kill switch：隧道不在时设备全网不可用。两个开关一旦拆开，
/// 就存在「接管开着、隧道断着、没有任何东西会把它拉回来」的稳定态——用户手里只剩「打开 App
/// 手动连一次」这一条自救路，而那恰恰是他多半想不到要做的事。绑上按需连接，这个稳定态不存在。
public enum OnDemandPolicy {
    /// 全局接管开着时，按需连接必须开着。
    public static func isRequired(includeAllNetworks: Bool) -> Bool {
        includeAllNetworks
    }

    /// 「包含所有网络」切换后的按需连接意图。
    ///
    /// 开启 → 强制置真；关闭 → **原样保留**：那是用户自己的开关，替他关掉等于替他撤掉保活。
    public static func intentAfterInclusionChange(
        includeAllNetworks: Bool,
        currentIntent: Bool
    ) -> Bool {
        includeAllNetworks || currentIntent
    }

    /// 设置页的按需连接 Toggle 能不能被关掉。
    public static func canDisable(includeAllNetworks: Bool) -> Bool {
        !isRequired(includeAllNetworks: includeAllNetworks)
    }
}
