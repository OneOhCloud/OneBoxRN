---
applies-to: src/modules/expo-onebox/android/src/main/java/expo/modules/onebox/oneoh/cloud/ExpoOneBoxModule.kt, src/modules/expo-onebox/ios/ExpoOneBoxModule.swift, src/modules/expo-onebox/src/ExpoOneBoxModule.ts, src/modules/expo-onebox/src/ExpoOneBoxModule.web.ts
loaded-when: any change to a bridge-crossing function's signature (return type, param type, nullability, name); implementer touches ExpoOneBoxModule surface
updated-on: new-convention
---

# bridge-signature

## rule
`ExpoOneBoxModule` has four layers that MUST stay in sync. One PR / one edit touches all four that cross the bridge.

| layer | location |
|---|---|
| Kotlin impl | `src/modules/expo-onebox/android/src/main/java/expo/modules/onebox/oneoh/cloud/ExpoOneBoxModule.kt` + helpers |
| Swift impl | `src/modules/expo-onebox/ios/ExpoOneBoxModule.swift` |
| TS interface | `src/modules/expo-onebox/src/ExpoOneBoxModule.ts` |
| Web stub | `src/modules/expo-onebox/src/ExpoOneBoxModule.web.ts` |

## why
category: bug.
failure: signature mismatches surface only at build time (Kotlin / Swift). missed until next compile — often hours after the TS change. web stub mismatch silently wrong-types downstream JS consumers.
constraint: pre-commit checklist per bridge edit:
1. Kotlin return type matches what `toMap()` / data class actually produces (`Any` vs `Any?`, `Map` vs `Map?`)
2. TS interface reflects updated return / param types
3. Web stub has matching stub signature (even if no-op)
4. Swift signature matches (if iOS has a parallel function)
5. all JS / TS call sites in hooks / tasks / screens type-compatible

reviewer flag: any one layer updated without the others = blocker.

## adding a new bridge method (sequence)
1. Kotlin — impl + data class if returning structured data
2. Swift — impl (often just "Not implemented" throw for Android-only methods)
3. TS — interface addition
4. Web — stub returning idiomatic default (promise resolving to null / empty object)
5. `make prebuild` — regenerates autolinking / codegen
6. JS call sites — use the new method

## removing a bridge method (sequence)
same 4 layers, remove from all four. if web stub still referenced in JS guard paths → remove those too in the same commit.
