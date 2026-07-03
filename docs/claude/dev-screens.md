---
applies-to: src/app/dev-smoke.tsx, src/app/config/dev.tsx, src/components/dev/**, src/debug/smoke-imports/**, src/debug/import-tests/**
loaded-when: 审查者标记 i18n / layout-flex；调查者在这些路径上触及带多个滚动兄弟节点的 flex 列
updated-on: platform-diff
---

# dev-screens

## 范围
仅限开发的诊断。深链接入口（`oneoh-networktools://dev-smoke`）。绝不会到达终端用户。

## i18n exemption
category: requirement-change.
为诊断清晰起见，优先硬编码英文。审查者在这些路径上跳过 i18n 标记。见项目 CLAUDE.md § Localization。

## flex 列规则（布局）
category: platform-diff.
failure: RN 会让一个 flex 列中两个可收缩的 ScrollView 兄弟节点相互争抢——下方兄弟的固有内容会驱动上方兄弟的高度。当 GroupSection 展开时过滤 chip 被挤压，全部折叠时又被拉伸。
constraint: 每个 flex 列最多 1 个可收缩子节点。用 `flexGrow:0 + flexShrink:0` 固定不伸缩的兄弟节点。内容 ScrollView 用 `flex:1`。

## 已接受的代价
改成三层布局（banner / chips / content）需要重新检查每一个不可收缩的兄弟节点；banner 包装器目前按内容尺寸，依赖隐式布局。

## smoke-import 条目约定
每个带原生侧的新运行时依赖，都要在添加该依赖的同一次提交里，于 `src/debug/smoke-imports/entries.ts` 加一个条目。条目主体使用动态 `await import('<pkg>')`、一次有代表性的调用，绝不修改可观察状态。见项目 CLAUDE.md § Native-import smoke check。
