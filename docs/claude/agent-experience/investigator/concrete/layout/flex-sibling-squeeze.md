---
id: investigator-layout-flex-sibling-squeeze
agent: investigator
scope: project:OneBoxRN
category: layout
priority: normal
calls: 0
helpful: 0
last-used: null
tags: [flex-layout, scroll-sibling, platform-diff, rn]
---

## 症状

多元素 flex 列；一个或多个子节点的尺寸与另一个子节点内部内容的大小成反比变化。在 Android + iOS 上都可见。常见情形：下方 section 展开时，过滤 chip 行被压缩；一切折叠时又重新拉伸。

## 教训

RN flex 列的默认值：`flexShrink: 1, flexGrow: 0, flexBasis: auto`。两个可收缩的子节点用固有高度协商空间。如果其中一个子节点是内容很高的 ScrollView，它会把其它子节点"饿死"。

规则：每个 flex 列最多 1 个可收缩子节点。用 `flexGrow: 0, flexShrink: 0` 固定所有不伸缩的兄弟节点。那个唯一可伸缩的子节点用 `flex: 1`。

诊断捷径：`git grep -n "ScrollView" <file>` → 如果 2 个以上 ScrollView 兄弟节点共享一列，那就是假设所在。

## 为什么模型需要它

基础模型会把 RN flex 当作 web CSS 对待。web 的固有高度来自子节点的自然布局，且 overflow scroll 是叠加的。RN 的 ScrollView 默认可 flex 收缩，会与兄弟节点争抢父节点的高度——与天真读者所假设的滚动区域行为恰好相反。
