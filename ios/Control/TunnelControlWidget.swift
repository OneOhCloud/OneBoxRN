import AppIntents
import SwiftUI
import WidgetKit

/// 控制中心控件（iOS 18 起）。
///
/// 全部视觉由系统渲染：我们只交一个 SF Symbol、一个标题、一个布尔值。不自绘、不注入品牌色
/// （`ControlWidget` 允许 `.tint(...)`，本仓选择不用）。
struct TunnelControlWidget: ControlWidget {
    static let kind = "cloud.oneoh.networktools.control.tunnel"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind, provider: TunnelStateProvider()) { isOn in
            ControlWidgetToggle(
                "control_label",
                isOn: isOn,
                action: ToggleTunnelIntent()
            ) { on in
                Label(
                    on ? "control_state_connected" : "control_state_disconnected",
                    systemImage: on ? "shield.lefthalf.filled" : "shield.slash"
                )
            }
        }
        .displayName("control_label")
        .description("control_intent_description")
    }
}

/// 取值供给：**每次被系统索取时现读**，不留缓存。
///
/// 已知边界：系统的刷新触发是「交互完成 / App 请求 / 推送」，Apple 没有承诺每次展开控制中心
/// 都重新查询。故 App 不存活、而状态被 On-Demand 或系统设置改掉时，控件可能滞后到下一次索取。
struct TunnelStateProvider: ControlValueProvider {
    /// 控件库里的预览：未连接态最不容易误导人（预览不该看起来像正连着）。
    let previewValue = false

    func currentValue() async throws -> Bool {
        await TunnelSessionGateway.isOn()
    }
}
