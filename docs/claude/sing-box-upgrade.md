---
applies-to: src/modules/expo-onebox/helper/Makefile, src/modules/expo-onebox/ios/Libbox.xcframework/**, src/modules/expo-onebox/android/libs/**, scripts/withOneBoxMTunnel.js, src/modules/expo-onebox/ios/add_onebox_tunnel.rb, src/modules/expo-onebox/ios/ExpoOneBoxModule.swift
loaded-when: bumping SING_BOX_TAG in helper/Makefile; rebuilding Libbox; debugging iOS "Undefined symbols" at link; debugging Swift "has been renamed to" in ExtensionPlatformInterface or command handler classes
updated-on: dep-upgrade
---

# sing-box-upgrade

## libbox.framework is a static archive
category: platform-diff.
failure: `Libbox.framework/Libbox` is `ar archive` (verify with `file`), not a Mach-O dylib. carries no `LC_LOAD_DYLIB` — consumer targets must add system `-l*` flags themselves.
constraint: both `OneBoxMTunnel` (Network Extension) AND `OneBoxM` (main app, links Libbox transitively via ExpoOneBox pod) need the flags. canonical patch: `scripts/withOneBoxMTunnel.js` (JS = source of truth, `.rb` sibling kept in sync but not what runs at build time).

## -lresolv required as of v1.13+
category: dep-upgrade.
symbols: `_res_9_ninit` / `_res_9_nclose` / `_res_9_nsearch` — pulled in by darwin DNS resolver in Go net package.
missing-flag symptom: `Undefined symbols for architecture arm64: "_<symbol>" referenced from: _runtime.text in Libbox[arm64](go.o)`.
future additions: identify owning system lib via `man <symbol>` or Apple SDK search, add `-l*` flag the same way.

## Swift bridge uses SHORT Swift names, not ObjC selectors
category: dep-upgrade.
failure: gomobile emits ObjC selectors AND Swift name aliases into the precompiled module (`.pcm`). Swift code must implement the short Swift name, not the long ObjC selector.

| ObjC selector (in header / binary) | Swift name (what Swift class implements) |
|---|---|
| `autoDetectInterfaceControl:error:` | `autoDetectControl(_:)` |
| `usePlatformAutoDetectInterfaceControl` | `usePlatformAutoDetectControl()` |
| `sendNotification:error:` | `send(_:)` |
| `writeConnectionEvents:` | `write(_:)` |

error `'foo' has been renamed to 'bar(_:)'` → `bar` is correct. do NOT "fix" to long ObjC selectors by reading `Libbox.objc.h` literally.

## verifying the Swift-name surface
```
clang -module-file-info <DerivedData>/.../SwiftExplicitPrecompiledModules/Libbox-*.pcm
strings <same.pcm> | grep -E "<methodName>"
```
PCM showing both long ObjC selector and short Swift name is normal.

## stale PCM cache triage
category: dep-upgrade.
failure: header / framework / binary all show new names but Swift still complains → SourceKit-managed DerivedData (`~/Library/Developer/Xcode/DerivedData/<App>-*/.../Index.noindex/.../Libbox-*.pcm`) is stale.
fix: `make clean-ios` — cleans both user-level DerivedData and project-local `target/DerivedData/`.

## xcpretty truncation
xcpretty mangles multi-line Swift diagnostics — shows source lines from one error against the line number of another, trims `{` to `}`. grab raw output: `xcodebuild ... 2>&1 | tee /tmp/log | xcpretty`, then `grep -A 5 "error:" /tmp/log`.

## version-specific breaks (append as discovered)
| sing-box version | affected layer | required change |
|---|---|---|
| v1.13.8 | android PlatformInterface.findConnectionOwner | ConnectionOwner.AndroidPackageName removed; use setAndroidPackageNames(StringIterator) setter. iOS impl throws "Not implemented", unaffected. |
