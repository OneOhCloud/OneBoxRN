import SwiftUI

/// 分段选择器：几个同级互斥取值并排，选中即生效。
///
/// 走系统分段控件：它的轨本就是半透明填充，坐在面板上、坐在页底上都读得出一条轨，
/// 滑块、手势、读屏全由系统给。
struct SegmentPicker<Option: Hashable>: View {
    let title: String
    let options: [(value: Option, label: String)]
    @Binding var selection: Option

    var body: some View {
        Picker(title, selection: $selection) {
            ForEach(options, id: \.value) { option in
                Text(option.label).tag(option.value)
            }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .sensoryFeedback(.selection, trigger: selection)
    }
}
