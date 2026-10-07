import AppIntents

/// 控件点按的动作。
///
/// `SetValueIntent` 收到的是**目标值**而不是「翻转」：系统把当前呈现态翻过来后传进来，这恰好
/// 就是想要的语义——呈现为开就断开、呈现为关就连接，连接中再点即取消这次连接。
///
/// **不设 `openAppWhenRun`**：它是类型级静态属性，没法在运行期发现「还没导入配置」之后才翻成
/// true；而为「打开 App」另设一个按钮式控件会把一个开关变成控制中心里的两个东西。
/// 那一支改为抛出带说明的错误，由系统就地提示。
struct ToggleTunnelIntent: SetValueIntent {
    static let title: LocalizedStringResource = "control_label"
    static let description = IntentDescription("control_intent_description")

    @Parameter(title: "control_label")
    var value: Bool

    func perform() async throws -> some IntentResult {
        try await TunnelSessionGateway.setOn(value)
        return .result()
    }
}
