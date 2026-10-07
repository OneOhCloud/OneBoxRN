import SwiftUI

extension View {
    /// 删除确认：挂在**触发删除的那一行**上，不挂在整页根上。
    ///
    /// iOS 26 起 `confirmationDialog` 以 popover 呈现，popover 的源就是修饰符所挂的那个视图：
    /// 挂在整页根上，箭头落在页底中央、指着空白；挂在行上，箭头才指着要删的那一行。
    ///
    /// 「哪一项待删」只有 `pending` 一个来源，每行只从它派生自己的呈现态，不另存一份。
    func deleteConfirmation<ID: Equatable>(
        _ title: String,
        for id: ID,
        pending: Binding<ID?>,
        onConfirm: @escaping () -> Void
    ) -> some View {
        let presented = Binding(
            get: { pending.wrappedValue == id },
            set: { if !$0 { pending.wrappedValue = nil } }
        )
        return confirmationDialog(title, isPresented: presented, titleVisibility: .visible) {
            Button(tr("delete"), role: .destructive) {
                onConfirm()
                pending.wrappedValue = nil
            }
            Button(tr("cancel"), role: .cancel) { pending.wrappedValue = nil }
        }
    }
}
