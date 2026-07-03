---
applies-to: src/modules/expo-onebox/helper/Makefile, src/modules/expo-onebox/ios/Libbox.xcframework/**, src/modules/expo-onebox/android/libs/**, scripts/withOneBoxMTunnel.js, src/modules/expo-onebox/ios/add_onebox_tunnel.rb, src/modules/expo-onebox/ios/ExpoOneBoxModule.swift
loaded-when: 在 helper/Makefile 中提升 SING_BOX_TAG；重新构建 Libbox；调试链接期的 iOS "Undefined symbols"；调试 ExtensionPlatformInterface 或命令处理器类中的 Swift "has been renamed to"
updated-on: dep-upgrade
---

# sing-box-upgrade

## libbox.framework 是静态归档
category: platform-diff.
failure: `Libbox.framework/Libbox` 是 `ar archive`（用 `file` 验证），不是 Mach-O dylib。它不带 `LC_LOAD_DYLIB`——消费方 target 必须自行添加系统 `-l*` 标志。
constraint: `OneBoxMTunnel`（Network Extension）**和** `OneBoxM`（主 app，经 ExpoOneBox pod 传递链接 Libbox）都需要这些标志。规范补丁：`scripts/withOneBoxMTunnel.js`（JS = 唯一来源，`.rb` 同级文件保持同步，但不是构建时实际运行的那个）。

## 自 v1.13+ 起需要 -lresolv
category: dep-upgrade.
symbols: `_res_9_ninit` / `_res_9_nclose` / `_res_9_nsearch`——由 Go net 包中的 darwin DNS 解析器引入。
missing-flag symptom: `Undefined symbols for architecture arm64: "_<symbol>" referenced from: _runtime.text in Libbox[arm64](go.o)`。
future additions: 通过 `man <symbol>` 或 Apple SDK 搜索找出所属的系统库，以同样方式添加 `-l*` 标志。

## Swift 桥接使用短 Swift 名，而非 ObjC selector
category: dep-upgrade.
failure: gomobile 会把 ObjC selector **和** Swift 名别名一起写入预编译模块（`.pcm`）。Swift 代码必须实现短的 Swift 名，而不是长的 ObjC selector。

| ObjC selector（头文件 / 二进制中） | Swift 名（Swift 类实现的名字） |
|---|---|
| `autoDetectInterfaceControl:error:` | `autoDetectControl(_:)` |
| `usePlatformAutoDetectInterfaceControl` | `usePlatformAutoDetectControl()` |
| `sendNotification:error:` | `send(_:)` |
| `writeConnectionEvents:` | `write(_:)` |

错误 `'foo' has been renamed to 'bar(_:)'` → `bar` 才是对的。不要按字面读 `Libbox.objc.h` 就"修"成长的 ObjC selector。

## 验证 Swift 名表面
```
clang -module-file-info <DerivedData>/.../SwiftExplicitPrecompiledModules/Libbox-*.pcm
strings <same.pcm> | grep -E "<methodName>"
```
PCM 同时显示长 ObjC selector 和短 Swift 名是正常的。

## 陈旧 PCM 缓存排查
category: dep-upgrade.
failure: 头文件 / framework / 二进制都显示新名，但 Swift 仍报错 → SourceKit 管理的 DerivedData（`~/Library/Developer/Xcode/DerivedData/<App>-*/.../Index.noindex/.../Libbox-*.pcm`）已陈旧。
fix: `make clean-ios`——同时清理用户级 DerivedData 和项目本地的 `target/DerivedData/`。

## xcpretty 截断
xcpretty 会弄乱多行 Swift 诊断——把某个错误的源码行配上另一个错误的行号，把 `{` 截到 `}`。抓原始输出：`xcodebuild ... 2>&1 | tee /tmp/log | xcpretty`，然后 `grep -A 5 "error:" /tmp/log`。

## 特定版本的破坏性变更（发现即追加）
| sing-box 版本 | 受影响的层 | 所需改动 |
|---|---|---|
| v1.13.8 | android PlatformInterface.findConnectionOwner | ConnectionOwner.AndroidPackageName 已移除；改用 setAndroidPackageNames(StringIterator) setter。iOS 实现抛出 "Not implemented"，不受影响。 |
