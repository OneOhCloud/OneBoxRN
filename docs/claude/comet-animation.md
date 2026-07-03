---
applies-to: src/components/ui/profiles/rotating-border.tsx, src/components/ui/home/connect-button.tsx, any new animated border or active-state arc / loading indicator
loaded-when: 实现者新增加载指示器 / 旋转边框 / 动画激活态圆环；审查者标记 comet 图层违规；调查者调试动画视图周围的 Android "矩形幽灵"
updated-on: new-convention
---

# comet-animation

## 设计意图
所有加载 + 激活态指示器统一采用科幻彗星扫掠效果。前缘对齐通过 `strokeDashoffset` 实现。使用透明度渐变图层，绝不用粗细渐变。

## 图层栈（后 → 前，所有层 strokeWidth={1.5}）

| 图层 | dash 长度 | strokeOpacity | strokeLinecap |
|---|---|---|---|
| wake（弥散尾迹） | 周长的 25-38% | 0.06 | round |
| plasma trail（等离子拖尾） | 16-24% | 0.15 | round |
| glow halo（光晕） | 12-16% | 0.35 | round |
| core line（核心线） | 10-16% | 0.90 | round |
| spark tip（头部火花） | ~2.5% | 1.00 | round |
| ghost counter-arc（可选，反向弧） | ~8% | 0.05 | round |

## 硬性规则
- 所有图层 `strokeWidth` 相等——彗星渐变由透明度驱动，而非粗细驱动
- 偏移公式：`strokeDashoffset = -(progress × perimeter) − (wakeDash − layerDash)`
- 单个共享的 `progress` 值（0 → 1 线性，`withRepeat`）
- 隐藏前至少 1.2 圈（`connect-button.tsx` 中的 `SPIN_MIN_REVOLUTIONS` 常量）
- 每一层的 `useAnimatedProps` 都必须在任何提前 `return null` 之前无条件调用（hooks 规则；违反会在运行时抛错）

## 圆角矩形几何（RotatingBorder）
```
const inset     = STROKE_W / 2
const innerW    = Math.max(0, width  - STROKE_W)
const innerH    = Math.max(0, height - STROKE_W)
const innerR    = Math.max(0, radius - inset)
const perimeter = 2 * (innerW + innerH - 2 * innerR) + 2 * Math.PI * innerR
```
当包裹 `useGlassSurface()` 卡片时传 `radius={22}`（它的 borderRadius 始终是 22）。

## Android shadow pitfall (hard-won)
category: platform-diff.
failure: 在 `opacity` 或 `transform` 会做动画的 `Animated.View` 上使用 `elevation` → 系统合成器会在变换前的边界处绘制阴影，当 opacity:0 时留下矩形幽灵。它不会随 opacity 淡出。即使不动 elevation，也会被祖先的 `overflow: 'hidden'` 裁剪。
constraint: 不要把 `elevation` 与带动画的 opacity/transform 组合。若要给动画视图做出凸起效果：
- iOS：`shadowColor/Offset/Opacity/Radius`（能正确合成）
- Android：`borderWidth: StyleSheet.hairlineWidth` + `borderColor: 'rgba(…, 0.08~0.12)'`（绕过合成器阴影路径，动画干净）
- 在样式数组内部用 `Platform.OS === 'ios' ? {...} : {...}` 做平台分支，而非通过 .ios.ts/.android.ts——差异仅在阴影外观。

## 为什么用透明度渐变而非粗细渐变
category: platform-diff.
粗细插值会在 Android 上引起抗锯齿闪烁；透明度合成在 iOS + Android 上都稳定。

## 现有实现参考
- `src/components/ui/profiles/rotating-border.tsx` —— 圆角矩形 `Rect` 图层 + 可选的逆时针反向弧
- `src/components/ui/home/connect-button.tsx` —— 圆形 `Circle` 图层，相同的透明度栈
