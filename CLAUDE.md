# OneBoxRN — Claude Code 指令

## 项目概览

React Native VPN 应用。Expo SDK 57 + Expo Router。核心引擎：sing-box v1.13.15（单一来源：`src/modules/expo-onebox/helper/Makefile` 中的 `SING_BOX_TAG`）。目标平台：iOS、Android、Web。

---

## 标准门禁

```bash
npx tsc --noEmit          # TypeScript: must print nothing
expo lint                 # ESLint: clean or only non-actionable warnings
make test                 # pure-TS test runner: all passing
```

干净 = 三者都以 0 退出，无新增错误。任何偏离都必须在返回结果中说明。

### 文件长度预算容忍度

≤ 简报声明预算的 1.3× → 不标记。≥ 1.5× → 标为 "concern" 并要求给出理由。

---

## 审查标记类别

项目专属的审查标记：

| 标记 | 规则来源 §（除注明外均为本文档） | 严重级别 |
|---|---|---|
| UI 直接调用 `ExpoOneBoxModule`（必须经由 `VpnContext`） | docs/claude/vpn-context.md | blocker |
| 桥接签名在 Kotlin / Swift / TS / Web stub 之间不同步 | docs/claude/bridge-signature.md | blocker |
| `elevation` 与带动画的 `opacity` 或 `transform` 组合使用 | docs/claude/comet-animation.md § Android shadow pitfall | blocker |
| 用户可见文本、标识符、注释或日志中出现 App Store 禁用术语 | App Store 术语规则（见下文） | blocker |
| 在 `src/app/dev-smoke.tsx` / `src/app/config/dev.tsx` 子树之外硬编码用户可见字符串 | docs/claude/dev-screens.md § i18n exemption + Localization（见下文） | concern |
| sing-box libbox 重新构建时缺少 `-lresolv`（iOS） | docs/claude/sing-box-upgrade.md | blocker |
| 任何面向 Claude 的文件中出现明文域名 / 后缀预映像 | docs/claude/domain-allowlist.md | blocker |
| 新增的动画边框违反 comet-layer 规范 | docs/claude/comet-animation.md | concern |
| 直接使用 `fetch`（必须用 `import { fetch } from 'expo/fetch'`） | 技术栈规则 → 数据获取 | concern |
| 在共享逻辑中用运行时 `Platform.OS` 实现平台差异，而非 `.ios.ts` / `.android.ts` | 技术栈规则 → RN / Expo | concern |

---

## App Store 术语规则

| 禁用 | 替换为 |
|---|---|
| subscription / 订阅 | config / configuration / profile |
| subscription link / 订阅链接 | config URL / profile URL |
| subscribe / 订阅（动词） | import / add / load config |
| subscription list / 订阅列表 | profile list / config list |
| subscription info / 订阅信息 | profile info / config info |
| subscription update / 订阅更新 | config refresh / profile sync |

禁止出现于：UI 字符串、i18n 键 + 值（`lang/en.json`、`lang/zh.json`）、标识符（组件 / 变量 / 函数）、注释、日志消息，以及任何用户可见文本。

同样应避免：暗示周期性付款、购买、计费或高级付费档位的措辞——除非是经 Apple 批准的应用内购买（in-app-purchase）流程。

---

## 项目专属规则文档

位于 `docs/claude/` 下的机器风格文档。按 `docs/claude/doc-index.json` 加载。

| 文档 | 范围 |
|---|---|
| [domain-allowlist.md](docs/claude/domain-allowlist.md) | hash 即密钥规则、预映像保密、如何添加受信域名 |
| [sing-box-upgrade.md](docs/claude/sing-box-upgrade.md) | Libbox 静态归档、-lresolv、Swift 短名 vs ObjC selector、陈旧 PCM、xcpretty 注意事项 |
| [bridge-signature.md](docs/claude/bridge-signature.md) | 四层同步规则（Kotlin / Swift / TS / Web）、增删顺序 |
| [vpn-context.md](docs/claude/vpn-context.md) | VpnContext 作为唯一修改者、只读例外 |
| [comet-animation.md](docs/claude/comet-animation.md) | 图层栈、几何、Android `elevation` 陷阱、透明度渐变 vs 粗细渐变 |
| [dev-screens.md](docs/claude/dev-screens.md) | dev-smoke + config/dev i18n 豁免、flex 列规则、smoke-entries 约定 |
| [config-fetch-policy.md](docs/claude/config-fetch-policy.md) | 规范的抓取/回落策略表、信任规则、CONFIG_LOAD token、刷新持久化契约、日志脱敏 |
| [terminology-exceptions.md](docs/claude/terminology-exceptions.md) | 术语禁令的已批准例外（桥接名、协议头、冻结的 SQL）、验收 grep |

---

## 测试先行节奏

对 `~/.claude/CLAUDE.md § Testing` 的项目层面复述。没有 GitHub Actions CI——本地通过是唯一门禁。

### 术语

- **test suite（测试套件）** — 带有通过/失败判定、可重复运行的程序化用例集。在本仓库中：`/dev-smoke` 上的 `SMOKE_IMPORT_ENTRIES + IMPORT_TEST_CASES` 组合，加上 `make test` 下的一切。
- **dev-tools card（开发工具卡片）** — 开发者屏幕（`src/app/config/dev.tsx`）上暴露单个临时探针/动作的卡片。`DebugActionsCard`、`BackgroundTaskCard`、`PrimaryUrlTestCard`（`Test` 后缀表示探针，不是套件）。

规则：新增测试用例 → dev-smoke 组合套件（而非新卡片）。新增手动探针 → 卡片。不要在同一个组件里混用。

### 测试载具

| 层 | 方式 |
|---|---|
| 纯 TS 辅助函数 | `make test` → `node --experimental-strip-types --test 'src/**/*.test.ts'` |
| android 后台 worker（手动） | `make test-bg-worker`（需要 adb 设备 + 已导入的配置文件） |
| 设备 UI / 原生模块 | 仅通过设备上的 `make run-ios` / `make run-android`——应急通道 |
| 原生导入 smoke | 在 `make run-*` 打包后执行 `make dev-smoke-ios` / `make dev-smoke-android` |
| 导入入口流程测试 | 在 `/dev-smoke` 挂载时自动运行（与 smoke 检查同一触发点） |

### 节奏

写函数 → 写测试 → `make test` 通过 → 下一步。所有新增的纯辅助函数（解析器、解码器、hash 胶水、后缀/路径、格式化器）都必须遵循。无业务逻辑的屏幕组件允许跳过——但必须明确声明，不得默默略过。

新的单元测试与模块放在一起：`src/foo/bar.ts` → `src/foo/bar.test.ts`。测试模块不得依赖原生导入（`expo-*`、`react-native`、`@/modules/*`）——node 的类型剥离运行器无法解析它们。如有必要，把纯核心提取到同级文件；模式：`src/utils/domain-suffix.ts` + `.test.ts`。

### 应急通道

仅设备可见的效果（`BGTaskScheduler` 触发、VPN 状态切换、触感反馈、NativeEvent）：依据全局应急通道规则——询问是否添加 `scripts/tmp-*.sh` adb 载具、推迟到手动设备运行，或记录为缺口。绝不可仅凭类型检查就声称"已测试"。

### Native-import smoke check

深链接 `oneoh-networktools://dev-smoke` 会挂载 `src/app/dev-smoke.tsx` → 自动运行 `src/debug/smoke-imports/entries.ts`——每个触及原生的包一次桥接调用。

工作流程（两个终端）：
1. 终端 A：`make run-ios` / `make run-android`
2. 等待 Metro 打印 `iOS Bundled …ms` / `Android Bundled …ms`
3. 终端 B：`make dev-smoke-ios` / `make dev-smoke-android`

已否决的做法：自动触发（用 `script(1)` 跟踪日志、Metro HTTP 探测、`adb logcat` follow）。原因：每一种在 macOS 上都会踩到 shell 时序或 TTY 捕获的边界情况。手动 Make 辅助命令：可 Tab 补全 + 两次按键。

目的：捕获 Hermes+RN 缺失的 Node/浏览器 API（历史案例：`crypto.subtle.digest` 让 QR 导入卡在 "verify"）。不是行为验证——只验证桥接可达性。

约定：每个带原生侧的新运行时依赖 → 在同一次提交里加一个 smoke 条目。

| 依赖类型 | smoke 条目 |
|---|---|
| `expo-*`、`react-native-*`、`@/modules/*`、`@gorhom/*`、原生 turbo/nitro | yes |
| `@expo-google-fonts/*`、图标包（可能触及原生字体加载器） | yes |
| 纯 JS（`i18n-js`、`jsonc-parser`、`nativewind`……） | no — 打包期即失败 |
| 开发依赖（`eslint`、`typescript`、`husky`……） | no — 非运行时 |
| 已被传递依赖覆盖的库 | no |

条目主体规则：
- 动态 `await import('<pkg>')`（node 测试运行器不会尝试解析原生模块）
- 不修改状态：不调用 `Clipboard.setStringAsync`、`Haptics.impactAsync`，不安排通知，不做导航
- 一次有代表性的调用 / 属性读取；"是否抛出"是唯一的断言
- 兜底：对必需的导出做 `expect(!!mod.X, ...)`

绿色行 → 继续。红色/橙色 → 通常是"忘了 `make prebuild`"，或"包依赖了 Hermes 缺失的 JS 引擎 API"。

### 导入入口流程测试

追加在同一个 `/dev-smoke` 页面的原生导入套件之后。用例：`src/debug/import-tests/cases.ts`。目标：`QR → verify → stop → download → apply` 入口链（config 导入流程机重构的回归保护）。使用 `FakeVpnModule` + 纯辅助函数——绝不触及真实的 `ExpoOneBox` / `ProfileStore` / 网络。分组：`import`、`parse`、`crypto`、`verify`、`apply`——页面上按组显示通过/总数表头 + 过滤 chip。

### 会话结束整理

任务完成后，列出新增测试 + 提议哪些应纳入长期的 `make test` 目标。在接线进 `make/test.mk` 之前，等待用户确认。

---

## 设备上验收与验证（开发环境）

本机拥有可用的原生构建 + 设备回路。**"已验证"意味着在设备上构建并观察到——绝不能仅凭 `tsc`/lint 推断**（见
`~/.claude/CLAUDE.md` 中的 § debugging discipline）。使用这些工具；不要推给手动运行或反问。

### 可用环境
- **Android 模拟器运行中** — `adb devices` → `emulator-5554`（AVD `Pixel_9`）；已安装 Android Studio。
- **Xcode 26.6** + CocoaPods；`ios/` 已预构建（存在 Podfile）。
- SDK 位于 `~/Library/Android/sdk`（`ANDROID_HOME`）；NDK / build-tools / platforms 齐备；JDK 21。
- `~/.gradle/init.gradle` 固定了阿里云镜像（Maven Central 经代理时不稳定——见 memory）。

### 验证工具（全部经由 Makefile / adb——绝不臆造）

| 工具 | 用途 |
|---|---|
| `make prebuild-android` / `make prebuild-ios` | 在**任何**原生改动后，从子模块重新生成原生工程 |
| `make run-android` | `expo run:android`——在当前 adb 目标上构建 + 安装 + 启动 |
| `cd android && ./gradlew :app:compileDebugKotlin`（prebuild 之后） | 对 Kotlin 原生改动做快速的仅编译检查 |
| `make dev-smoke-android` / `-ios` | 触发深链接 `oneoh-networktools://dev-smoke` → 在设备上运行原生导入 smoke + 导入流程套件 |
| `make screenshot-android` | `adb exec-out screencap` → `target/screenshots/android-<ts>.png`（多设备：`ADB_SERIAL=<serial>`） |
| `adb logcat` | 主要观察通道——RN `console.*`/`jsLog` → 标签 `ReactNativeJS`；原生 `android.util.Log` / `onNativeLog` → 按子系统分标签 |

### 原生验证循环（原生改动后强制执行）

1. `make prebuild-android` → `cd android && ./gradlew :app:compileDebugKotlin`（或 `assembleDebug`）——**必须干净编译通过**。
2. 在模拟器上安装 + 启动；`make dev-smoke-android`；读取 `adb logcat` 中的载具标记；`make screenshot-android` 确认 UI。
3. 通过下文的开发载具信号驱动被测行为；对日志标记做断言。
4. `.swift` 上的 IDE/SourceKit 诊断（例如 `No such module 'ExpoModulesCore'`、`BGTaskScheduler is unavailable in macOS`、跨文件的 `Cannot find … in scope`）在没有构建上下文时**都是噪声——忽略它们；相信 `gradlew` / `xcodebuild`。**

### 开发载具——交互接口与信号（仅限 DEV）

为实现自动化、非手动的验收，应用暴露了通过 `adb` 驱动的信号。**不留盲点**：如果被验收的行为在 logcat 中看不到，就先加一个标记，再声称它已验证。

- **信号入** — 深链接 `oneoh-networktools://dev-harness?op=<op>&…`（**仅在 `__DEV__` 下注册**）驱动 VPN 动作（start / stop / select-node / refresh）及诊断，且不触及生产 UI。通过 `adb shell am start -a android.intent.action.VIEW -d '<url>'` 触发。
- **日志出** — 每个载具动作和每次可观察的状态切换都会向 logcat 发出一行可被机器解析的 `[[HARNESS]] op=… key=value …`（JS 经 `jsLog`，原生经 `Log`/`onNativeLog`）。
- **守卫** — 所有 `dev-harness` 深链接和 `[[HARNESS]]` 日志**仅在 `__DEV__`（JS）/ `BuildConfig.DEBUG`（原生）时**编译/注册；它们绝不能进入 release 构建或被用户看到。

---

## 命令

全部经由 Makefile。绝不臆造。

```bash
# Development
make run-ios               # iOS debug
make run-android           # Android debug
expo start --web           # web dev server

# Prebuild (required after any native dep change)
make prebuild              # all platforms
make prebuild-ios
make prebuild-android

# Release
make ios-archive           # iOS App Store archive
make android               # Android AAB

# Clean
make clean                 # remove all build artifacts

# Lint
expo lint                  # ESLint (expo flat config)

# Dev-smoke (after run-*)
make dev-smoke-ios
make dev-smoke-android
```

---

## 架构

### 目录结构

```
src/
├── app/                   # Expo Router file-based routes
│   ├── _layout.tsx        # root layout (providers, theme, init)
│   ├── (tabs)/            # bottom tab nav
│   │   ├── index.tsx      # home (VPN control)
│   │   ├── profile.tsx    # profile/config management
│   │   └── settings.tsx
│   └── config/            # config / debug stack
├── components/ui/         # feature UI, grouped by screen
├── constants/             # theme colours, palette, language, cache keys
├── contexts/              # React Context (VPN runtime state)
├── database/              # SQLite + KV store
├── debug/                 # dev-smoke + import-test harnesses
├── hooks/                 # business-logic hooks
├── modules/expo-onebox/   # native module (sing-box bridge)
├── lang/                  # i18n (en.json / zh.json)
├── tasks/                 # background tasks
└── utils/                 # utilities
```

### 状态管理

| 层 | 机制 | 范围 |
|---|---|---|
| VPN 运行时 | `VpnContext`（`src/contexts/vpn-context.tsx`） | 连接状态、流量、日志、模式 |
| 持久化配置 | SQLite KV（`src/database/kv.ts`） | 偏好、规则、DNS |
| 配置文件数据 | 基于 KV 存储的 `ProfileStore`（`src/database/kv.ts` + `profile-store-core.ts`） | 配置文件及其 config，以 `kv_store` 行存储 |
| 本地 UI 状态 | 组件状态 + hooks | 弹窗、底部面板、表单 |

不引入新的状态库。所有持久化状态都通过 `kvGet`/`kvSet` 存放在单一的 `kv_store` SQLite 表中。（`sqlite3.tsx` 中遗留的 `subscriptions` / `subscription_configs` 表已迁移冻结且为空——没有读者也没有写者；见那里的注释。）

### 导航

- Expo Router 基于文件，启用 `typedRoutes` 实验特性
- 底部标签：iOS 用原生 / Android 用 Material3 / Web 用自定义
- 弹窗：QR 扫描器、URL 导入

---

## 技术栈规则

### React Native / Expo

- 严格 TypeScript：不用 `any`、`@ts-ignore`、`as unknown as X`
- 平台差异通过 `.ios.ts` / `.android.ts` 文件实现——共享逻辑中不用运行时 `Platform.OS`
- 重计算移出 JS 线程（Worklets / Reanimated）
- 绝不假设 iOS 与 Android 行为一致
- 单平台 bug → 先检查平台差异假设（多数"幽灵"是合成器问题，而非代码）
- 使用 `import { fetch } from 'expo/fetch'`，绝不用全局 `fetch`。全局 RN fetch 是 XHR polyfill，`AbortController` 不可靠；超时的请求会以不透明的 `TypeError: Network request failed` 而非 `AbortError` 呈现。expo/fetch 符合 WinterCG，并能正确取消原生请求。

### 阴影 / elevation

见 `docs/claude/comet-animation.md § Android shadow pitfall`。摘要：任何参与 opacity / transform 动画的视图都不得使用 `elevation`。

### 动画

见 `docs/claude/comet-animation.md`。任何新增的动画边框 / 加载指示器都遵循 comet 图层规范。

### 样式

- 官方 Expo Tailwind 指南：https://docs.expo.dev/guides/tailwind/
- 通过 `className` 使用 NativeWind v5 + Tailwind v4（`@tailwindcss/postcss`）
- 基于 CSS 的配置在 `src/global.css`（Tailwind v4 不用 `tailwind.config.js`）
- 主题颜色通过 `src/constants/theme.ts` 中的 `Colors` 对象、经 `useTheme()` hook 解析——绝不硬编码（不存在主题 CSS 变量；`var(--…)` 仅用于 Web 字体族）
- 不要用线条、分隔线、发丝线或边框描边来营造视觉层次；改用颜色和色调对比
- 不引入新的样式库

### 数据获取

- 配置文件抓取：导入流程（`src/hooks/import-flow-machine.ts` + `use-import-flow.ts`）通过原生桥接 `ExpoOneBox.fetchSubscription` 下载，后者会应用回落加速代理。抓取错误/回落策略：`src/utils/config-fetch-policy.ts`（规范策略表：`docs/claude/config-fetch-policy.md`）。
- 超时按路径而定，不是一个全局值：JS 通用 `fetchWithTimeout` = 10 s（`src/utils.ts`）；远程模板抓取 = 15 s（`src/database/config-template.ts`）；DNS 探测 = 2 s（`src/database/helper.ts`）；原生 config 抓取 = 30 s 墙钟（见 config-fetch-policy.md）。全部通过 `AbortController` / 原生调用超时实现。
- 解析 `subscription-userinfo` 响应头（HTTP 头名称——尽管有术语禁令仍被允许）以获取流量/到期信息

### Localization

- 用户可见字符串都经过 `i18n-js`（`src/lang/en.json` + `zh.json`）
- 组件中不硬编码中英文
- i18n 键按 App Store 术语规则使用中性术语
- 例外：`src/app/dev-smoke.tsx` + `src/app/config/dev.tsx` 及其子文件（仅限开发、绝不作为用户可见内容发布）——见 `docs/claude/dev-screens.md`

### 版本管理

- 单一来源：`version.json`
- 构建脚本自动同步到 iOS `Info.plist`（`scripts/sync-version-ios.js`）和 Android `android/app/build.gradle`（`scripts/sync-version-android.js`）——而非 Android manifest

---

## 领域规则（VPN 专属）

- VPN 状态变更都经由 `VpnContext`——绝不从 UI 直接调用 `ExpoOneBoxModule`。见 `docs/claude/vpn-context.md`。
- sing-box 配置变更使用模板系统：`src/database/config-template.ts`（抓取/缓存/检视）+ `src/database/config-merge-core.ts`（纯合并），内置模板在 `src/database/template/generated.ts`（由 `scripts/sync-templates.ts` 重新生成）。
- 原生模块（`src/modules/expo-onebox`）改动在运行前需要 `make prebuild`。
- 后台任务（config 刷新）只通过 iOS BGTaskScheduler / Android WorkManager 注册——不用 JS 定时器。

---

## 反模式

- 编排层（布局 / 屏幕）中不放业务逻辑——提取到 hooks
- 不做顶层 `utils/` / `helpers/` 分组——按领域组织
- 不用 `isLoading` / `isSubmitting` 作为防重复提交的主要手段——优先使用幂等 API
- 不臆造 sing-box 配置字段或 `ExpoOneBox` API——用 `// UNVERIFIED` + 说明
- 原生改动后绝不跳过 `make prebuild`
