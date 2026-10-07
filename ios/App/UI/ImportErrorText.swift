import Core

// 领域错误 → 用户文案（i18n 只在 UI 层映射）：
// 导入失败视图与配置刷新失败 Alert 共用的唯一映射。
extension ImportError {
    /// 失败视图标题：StartFailed 时下载已成功，标题按错误类分化（其余三类为下载失败）。
    var titleText: String {
        switch self {
        case .startFailed: return tr("import_start_failed")
        case .downloadNetwork, .downloadHttp, .invalidContent: return tr("import_failed")
        }
    }

    /// 分类提示文案。
    var hintText: String {
        switch self {
        case .downloadNetwork: return tr("import_error_network")
        case .downloadHttp(let statusCode): return tr("import_error_http", String(statusCode))
        case .invalidContent: return tr("import_error_content")
        case .startFailed: return tr("import_error_start")
        }
    }

    /// 原始诊断：携消息的错误展示原文，其余展示**人读得懂的形态**。
    ///
    /// **不得直接端出 `token`**：那是给 golden 相位轨迹与终态断言用的稳定标识符
    /// （`ImportFlow.swift` 自己写明「i18n 文案在 UI 层映射」），把 `download-http:404`
    /// 摆到用户面前是内部标识符泄漏。与 Android `ImportErrorText.kt` 逐条同形。
    var detailText: String {
        switch self {
        case .downloadNetwork(let message), .startFailed(let message):
            return message
        case .downloadHttp(let statusCode):
            return "HTTP \(statusCode)"
        case .invalidContent(let reason):
            return reason.diagnosticName
        }
    }

    /// 刷新失败 Alert 的单段文案：提示行 + 原始详情。
    /// **HTTP 状态已含于提示行，不重复**（与 Android `importErrorAlertText` 同形）。
    var alertText: String {
        switch self {
        case .downloadHttp:
            return hintText
        // **逐项列全而不写 `default:`**：`ImportError` 是自有枚举，
        // 写 `default:` 等于手动关掉编译器的穷尽检查 —— 新加一个失败种类时，
        // 它会静默走到「提示行 + 详情」这一支，而那未必是对的呈现。
        case .downloadNetwork, .invalidContent, .startFailed:
            return hintText + "\n" + detailText
        }
    }
}

private extension ContentReject {
    /// 与 Android `ContentReject.name` 同形（`EMPTY` / `NOT_JSON` / `NOT_OBJECT`）。
    var diagnosticName: String {
        switch self {
        case .empty: return "EMPTY"
        case .notJson: return "NOT_JSON"
        case .notObject: return "NOT_OBJECT"
        }
    }
}
