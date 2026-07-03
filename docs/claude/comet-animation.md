---
applies-to: src/components/ui/profiles/rotating-border.tsx, src/components/ui/home/connect-button.tsx, any new animated border or active-state arc / loading indicator
loaded-when: implementer adds new loading indicator / rotating border / animated active-state ring; reviewer flags comet layer violation; investigator debugs Android "rectangular ghost" around an animated view
updated-on: new-convention
---

# comet-animation

## design intent
unified sci-fi comet sweep across all loading + active-state indicators. front-edge alignment via `strokeDashoffset`. opacity-gradient layers, never thickness-gradient.

## layer stack (back → front, strokeWidth={1.5} for all)

| layer | dash length | strokeOpacity | strokeLinecap |
|---|---|---|---|
| wake (diffuse tail) | 25-38% perimeter | 0.06 | round |
| plasma trail | 16-24% | 0.15 | round |
| glow halo | 12-16% | 0.35 | round |
| core line | 10-16% | 0.90 | round |
| spark tip (head) | ~2.5% | 1.00 | round |
| ghost counter-arc (optional) | ~8% | 0.05 | round |

## hard rules
- all layers `strokeWidth` equal — comet gradient is opacity-driven, not thickness-driven
- offset formula: `strokeDashoffset = -(progress × perimeter) − (wakeDash − layerDash)`
- single shared `progress` value (0 → 1 linear, `withRepeat`)
- min 1.2 revolutions before hide (`SPIN_MIN_REVOLUTIONS` constant in `connect-button.tsx`)
- `useAnimatedProps` for every layer called unconditionally BEFORE any early `return null` (rules-of-hooks; violating throws at runtime)

## rounded-rect geometry (RotatingBorder)
```
const inset     = STROKE_W / 2
const innerW    = Math.max(0, width  - STROKE_W)
const innerH    = Math.max(0, height - STROKE_W)
const innerR    = Math.max(0, radius - inset)
const perimeter = 2 * (innerW + innerH - 2 * innerR) + 2 * Math.PI * innerR
```
pass `radius={22}` when wrapping a `useGlassSurface()` card (its borderRadius is always 22).

## Android shadow pitfall (hard-won)
category: platform-diff.
failure: `elevation` on `Animated.View` whose `opacity` or `transform` animates → system compositor draws shadow at pre-transform bounds, leaves rectangular ghost when opacity:0. does not fade with opacity. clipped by ancestor `overflow: 'hidden'` even when elevation untouched.
constraint: do NOT combine `elevation` with animated opacity/transform. for raised look on animated view:
- iOS: `shadowColor/Offset/Opacity/Radius` (composites correctly)
- Android: `borderWidth: StyleSheet.hairlineWidth` + `borderColor: 'rgba(…, 0.08~0.12)'` (compositor shadow path bypassed, animates clean)
- platform-split with `Platform.OS === 'ios' ? {...} : {...}` INSIDE the style array, not via .ios.ts/.android.ts — divergence is shadow chrome only.

## why opacity-gradient not thickness-gradient
category: platform-diff.
thickness interpolation causes anti-alias flicker on Android; opacity compositing is stable across iOS + Android.

## existing impl references
- `src/components/ui/profiles/rotating-border.tsx` — rounded-rect `Rect` layers + optional CCW counter-arc
- `src/components/ui/home/connect-button.tsx` — circular `Circle` layers, same opacity stack
