---
applies-to: src/modules/expo-onebox/android/src/main/java/expo/modules/onebox/oneoh/cloud/ExpoOneBoxModule.kt, src/modules/expo-onebox/ios/ExpoOneBoxModule.swift, src/modules/expo-onebox/src/ExpoOneBoxModule.ts, src/modules/expo-onebox/src/ExpoOneBoxModule.web.ts
loaded-when: 对任何跨桥函数签名的改动（返回类型、参数类型、可空性、名称）；实现者触及 ExpoOneBoxModule 表面
updated-on: new-convention
---

# bridge-signature

## 规则
`ExpoOneBoxModule` 有四层，必须保持同步。一次 PR / 一次编辑要同时改动所有四层中跨桥的部分。

| 层 | 位置 |
|---|---|
| Kotlin 实现 | `src/modules/expo-onebox/android/src/main/java/expo/modules/onebox/oneoh/cloud/ExpoOneBoxModule.kt` + 辅助文件 |
| Swift 实现 | `src/modules/expo-onebox/ios/ExpoOneBoxModule.swift` |
| TS 接口 | `src/modules/expo-onebox/src/ExpoOneBoxModule.ts` |
| Web stub | `src/modules/expo-onebox/src/ExpoOneBoxModule.web.ts` |

## 为什么
category: bug.
failure: 签名不匹配只在构建时（Kotlin / Swift）暴露。直到下次编译才会发现——往往在 TS 改动数小时之后。web stub 不匹配会悄悄给下游 JS 消费者错误的类型。
constraint: 每次桥接编辑的提交前检查清单：
1. Kotlin 返回类型与 `toMap()` / data class 实际产生的一致（`Any` vs `Any?`、`Map` vs `Map?`）
2. TS 接口反映更新后的返回 / 参数类型
3. Web stub 有匹配的 stub 签名（即使是 no-op）
4. Swift 签名匹配（如果 iOS 有对应函数）
5. hooks / tasks / screens 中所有 JS / TS 调用点类型兼容

reviewer flag: 只更新其中一层而不更新其它层 = blocker。

## 新增桥接方法（顺序）
1. Kotlin —— 实现 + 若返回结构化数据则加 data class
2. Swift —— 实现（Android 专属方法通常只是抛出 "Not implemented"）
3. TS —— 新增接口
4. Web —— stub 返回符合惯例的默认值（resolve 为 null / 空对象的 promise）
5. `make prebuild` —— 重新生成 autolinking / codegen
6. JS 调用点 —— 使用新方法

## 移除桥接方法（顺序）
同样的四层，从全部四层移除。如果 web stub 仍被 JS 守卫路径引用 → 在同一次提交里一并移除。
