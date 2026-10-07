import Core

/// 导入成功页的四段文字：结论、后果、主按钮、次按钮。
struct ImportSuccessLabels: Equatable {
    let headline: String
    let consequence: String
    let primary: String
    let secondary: String
}

/// 导入失败页的按钮：可重试时主按钮「重试」、次按钮「返回」；只能返回时只有一颗「返回」。
struct ImportFailureLabels: Equatable {
    let primary: String
    let secondary: String?
}

/// 导入结论页的文字。判定在 core `ImportConclusion`（golden 裁判），这里只把判定换成文案。
enum ImportConclusionText {
    static func success(
        outcome: ImportOutcome,
        consequence: ImportConclusion.Consequence,
        primary: ImportConclusion.PrimaryAction
    ) -> ImportSuccessLabels {
        ImportSuccessLabels(
            headline: headline(outcome),
            consequence: text(consequence),
            primary: text(primary),
            secondary: tr("import_done")
        )
    }

    static func failure(_ actions: ImportConclusion.FailureActions) -> ImportFailureLabels {
        switch actions {
        case .retryOrBack: ImportFailureLabels(primary: tr("config_retry"), secondary: tr("back"))
        case .backOnly: ImportFailureLabels(primary: tr("back"), secondary: nil)
        }
    }

    /// 新增说「导入成功」，同一链接再导入说「配置已更新」。
    private static func headline(_ outcome: ImportOutcome) -> String {
        switch outcome {
        case .added: tr("import_success")
        case .updated: tr("import_updated")
        }
    }

    private static func text(_ consequence: ImportConclusion.Consequence) -> String {
        switch consequence {
        case .activeNow: tr("import_active_note")
        case .activeAfterReconnect: tr("import_reconnect_note")
        }
    }

    private static func text(_ action: ImportConclusion.PrimaryAction) -> String {
        switch action {
        case .connect: tr("home_connect")
        case .useNow: tr("import_use_now")
        }
    }
}
