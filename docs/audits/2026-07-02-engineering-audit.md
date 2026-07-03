# OneBoxRN 工程审计

日期：2026-07-02

## 基线

- 项目基线：`expo@^57.0.0`、`react-native@0.86.0`、`react@19.2.3`、`expo-router@~57.0.2`。
- 当前官方依据：
  - Expo SDK 57 目标为 React Native 0.86、React 19.2.3、React Native Web 0.21.0 和 Node 22.13.x：https://docs.expo.dev/versions/latest/
  - React Native 将 0.86 列为最新稳定版：https://reactnative.dev/versions
  - Expo 推荐用 `npx expo-doctor@latest` 做 New Architecture 依赖校验：https://docs.expo.dev/guides/new-architecture/
  - Expo Router 是 Expo 项目推荐的导航方案：https://docs.expo.dev/develop/app-navigation/

## 验证快照

| 检查 | 结果 | 备注 |
| --- | --- | --- |
| `npx tsc --noEmit` | 通过 | 无输出。 |
| `npm test` | 通过 | 66 个测试，7 个套件，0 失败。Node 会打印实验性类型剥离和模块类型警告。 |
| `npx expo-doctor@latest` | 通过 | 20/20 项检查通过。该命令会加载 `.env`；不要在日志或报告中回显机密值。 |
| `npx expo install --check` | 通过 | 依赖与 Expo SDK 对齐。 |
| `npx expo lint` | 失败 | 33 个错误，多为 React hook 纯度/不可变性规则。 |
| `npm audit --omit=dev --audit-level=moderate` | 失败 | 20 个生产依赖漏洞：1 低、13 中、5 高、1 严重。 |

## 发现

### F-01 Blocker：VPN 桥接修改未集中化

证据：
- `src/hooks/use-home-screen.ts:56-69` 直接调用 `ExpoOneBox.stop`、Android 权限 API 和 `ExpoOneBox.start`。
- `src/app/(tabs)/index.tsx:226-231` 从 tab 屏幕调用 `ExpoOneBox.selectProxyNode`。
- `src/hooks/use-proxy-nodes.ts:63-64` 触发原生 URL 测试，`src/hooks/use-proxy-nodes.ts:87-108` 在 `VpnContext` 之外监听 `onGroupUpdate`。
- `src/app/config/index.tsx:516-541` 直接添加 `onStatusChange` 监听器并调用 `ExpoOneBox.stop`；`src/app/config/index.tsx:573-611` 调用权限 API 和 `ExpoOneBox.start`。

为什么重要：
- `CLAUDE.md` 和 `docs/claude/vpn-context.md` 将 `VpnContext` 定义为唯一的 VPN 修改者和事件拥有者。多个 UI 层修改者会更容易导致 start/stop 竞争、UI 状态陈旧、重复的原生监听器以及不一致的错误处理。

所需整改：
- 为 start、stop、restart、权限关卡、节点选择和 URL 测试触发添加显式的 `VpnContext` 动作。
- 把 `onGroupUpdate` 的所有权移入 `VpnContext`，或记录一个带单一共享监听表面的只读例外。
- 更新 UI hooks/路由，使其只调用上下文动作。开发/调试屏幕可保留已记录的诊断例外。

验收标准：
- `rg -n "ExpoOneBox\\.(start|stop|selectProxyNode|triggerURLTest|addListener)" src/app src/hooks src/components` 只返回 `VpnContext`、原生/后台工具例外，以及已记录的开发探针。
- start/stop/导入流程在 iOS 和 Android 上仍通过手动原生 smoke。

### F-02 Blocker：前台 config 刷新的持久化在各平台间不一致

证据：
- Android 有意不存储手动刷新结果：`src/modules/expo-onebox/android/src/main/java/expo/modules/onebox/oneoh/cloud/ExpoOneBoxModule.kt:640-645`。
- iOS 在返回前会存储手动刷新结果：`src/modules/expo-onebox/ios/ExpoOneBoxModule.swift:278-281`。
- JS 已经直接应用手动刷新结果：`src/tasks/config-refresh.ts:117-119`。
- JS 前台同步会读取并清除原生的最近结果存储：`src/tasks/config-refresh.ts:129-136`。

为什么重要：
- 在 iOS 上，手动前台刷新可能被直接应用，随后又通过 `syncNativeResultToJS()` 被回放，产生重复的 TaskLog 条目，并可能覆盖手动与后台结果之间本应有的区分。

所需整改：
- 让 iOS 与 Android 对齐，除非产品意图明确要求持久化手动刷新结果。
- 添加一个桥接一致性测试或 smoke 探针，调用 `executeConfigRefreshNow`，然后断言 `getLastConfigRefreshResult()` 不会返回那个相同的手动结果。

验收标准：
- Android 和 iOS 对手动前台刷新存储记录相同的规则。
- TaskLog 每次手动执行记录一条 manual 条目，每次实际后台执行记录一条 auto 条目。

### F-03 High：Android 自定义 TLS 信任路径需要安全审查

证据：
- Android 为 IP 直连的 HTTPS 构建了自定义 `SNISocketFactory`：`src/modules/expo-onebox/android/src/main/java/expo/modules/onebox/oneoh/cloud/helper/ConfigFetcher.kt:40-70`。
- 传给 `.sslSocketFactory(...)` 的 OkHttp `X509TrustManager` 的 `checkClientTrusted` 和 `checkServerTrusted` 都是 no-op：`ConfigFetcher.kt:118-131`。
- 注释称系统信任由默认 SSL context 强制，但 OkHttp 依赖所提供的 trust manager 来做证书链校验。
- iOS 使用 Network.framework 的 TLS 选项，并声称在无手动覆盖的情况下做完整的系统信任评估：`src/modules/expo-onebox/ios/core/ConfigFetcher.swift:42-49` 和 `:110-135`。

为什么重要：
- 如果 Android 的 trust manager 真的绕过了证书链校验，config 抓取可能暴露于 MITM 攻击。这会影响配置文件导入和后台刷新。

所需整改：
- 用平台默认的 `X509TrustManager` 替换 no-op trust manager，并传入默认 trust manager 工厂所使用的同一个实例。
- 针对证书无效的主机添加一个否定测试/手动探针，针对需要 SNI 的有效主机添加一个肯定测试。
- 不要削弱主机名校验；保持针对原始主机名的校验。

验收标准：
- 无效证书链在 Android 上失败。
- 通过解析出的 IP 带 SNI 连接时，原始主机名的有效证书成功。
- iOS 和 Android 行为记录在桥接/原生 fetcher 说明中。

### F-04 High：config 抓取回落语义不一致且测试不足

证据：
- `fetchConfigWithFallback` 记录称超时应回落：`src/utils/profile-loader.ts:50-58` 和 `:113-119`。
- primary 抓取的 catch 块在 `isNetworkFault()` 能触发回落之前就重新抛出了 `AbortError`：`src/utils/profile-loader.ts:162-170`。
- JS 配置文件抓取使用 10s 超时：`src/utils/profile-loader.ts:147-152`。
- 远程模板抓取使用单独的 15s 超时路径，并记录完整的模板 URL：`src/database/helper.ts:172-193`。
- 原生 fetcher 使用 15s connect、30s read 和 60s call 超时：`ConfigFetcher.kt:129-135`。
- Web `fetchWithTimeout` 对每个输入都返回 mock 成功：`src/utils.ts:105-113`。

为什么重要：
- 用户看到的行为会因流程使用 JS 前台抓取、原生前台抓取、原生后台抓取、模板抓取还是 web 而不同。已记录的回落策略未被完全强制执行。

所需整改：
- 为超时、网络错误、DNS 错误、HTTP 非 2xx、未验证域名、加速器不可用和取消定义一张策略表。
- 在可行处实现 JS 与原生共享的类型化错误标签。
- 让取消与超时区分开：用户发起的中止不应回落；墙钟超时应遵循所选策略。
- 用可注入的 fetch/可达性钩子为 `fetchConfigWithFallback` 添加纯测试，或提取决策核心。

验收标准：
- 测试用例覆盖 primary 成功、HTTP 失败不回落、超时回落、DNS/网络回落、未验证域名拒绝回落、加速器不可用、加速器 HTTP 失败，以及调用方取消。
- 前台 JS/原生与后台原生日志使用相同的 method/status 词汇。

### F-05 High：可观测性有用，但结构化程度不足以支撑可追溯性

证据：
- 日志条目只有 `{source, level, message, time}`：`src/utils/log-sink.ts:21-27`。
- `jsLog` 把任意散文字符串镜像到 console 和内存环形缓冲区：`src/utils/log-sink.ts:143-166`。
- config 加载日志包含完整的原始或加速 URL：`src/utils/profile-loader.ts:160` 和 `:212-214`。
- TaskLog 存储 primary URL、加速 URL 和原始 `subscription-userinfo` 头：`src/database/kv.ts:340-361`；追加发生在 `src/tasks/config-refresh.ts:160-175`。
- Bugsnag 已初始化，但对 config 导入、VPN start、刷新或原生桥接事件没有可见的 breadcrumb/metadata 分类：`src/app/_layout.tsx:32-36`。

为什么重要：
- 应用有一个不错的日志 sink，但未来的调试仍依赖散文搜索。它还在没有明确脱敏契约的情况下持久化或展示敏感的运行细节。

所需整改：
- 引入结构化事件字段：`event`、`flowId`、`profileIdHash`、`platform`、`phase`、`status`、`method`、`durationMs`，以及类型化的 `errorCode`。
- 默认脱敏 URL。仅在用户可见调试需要时才存储主机 hash、路径 hash 和主机显示名。
- 让原始头不进入持久日志，除非已明确脱敏或存储在仅限开发的开关下。
- 为高层决策添加 Bugsnag breadcrumb，为最近失败状态添加 Bugsnag metadata，且不含 config 主体、token、URL 查询或完整头值。

验收标准：
- 一个失败的 QR/导入/应用流程可以用一个 `flowId` 从捕获一路跟踪到 verify、stop、download、store、process、start 以及最终 UI 结果。
- 清除应用内日志会清掉易失日志，但不会抹去支持所需的最新持久失败摘要。

### F-06 High：lint 门禁当前在 React 19 时代规则下失败

证据：
- `npx expo lint` 报告 33 个错误。
- 主要类别：
  - `react-hooks/set-state-in-effect`：`src/app/config/index.tsx:40`、`:417`、`:481`、`src/contexts/vpn-context.tsx:165`、`src/hooks/use-proxy-nodes.ts:75` 等。
  - `react-hooks/refs`：`src/app/config/index.tsx:393`、`src/components/ui/home/node-list.tsx:67`、`:75`、`:82`、`:123`。
  - `react-hooks/immutability`：Reanimated shared-value 写入，见 `src/components/ui/home/connect-button.tsx:253-254`、`src/components/ui/profiles/rotating-border.tsx:109`、`src/components/ui/tab-focus-animator.tsx:48-50`。
  - `react-hooks/purity`：在 `src/components/ui/profiles/active-profile-card.tsx:107` 的渲染期间调用 `Date.now()`。

为什么重要：
- 只要这些错误还在，项目就无法满足其声明的标准门禁。若干发现也与 React Compiler 和 Reanimated 最佳实践重叠。

所需整改：
- 把 lint 修复拆成窄批次：由 hook 派生的初始状态、渲染期间的 ref 访问、Reanimated shared-value API，以及不纯的渲染调用。
- 为 Reanimated 4 + 潜在的 React Compiler 就绪，在受支持处优先使用 `.get()`/`.set()`，并与项目的 compiler 设置对齐。
- 不要抑制这些规则，除非有已记录的 Expo/RN/Reanimated 不兼容要求这样做。

验收标准：
- `npx expo lint` 以 0 退出。
- 手动 UI smoke 确认动画控件行为仍然正确。

### F-07 High：生产依赖审计失败

证据：
- `npm audit --omit=dev --audit-level=moderate` 报告 20 个漏洞。
- 值得注意的包：`shell-quote` 严重；`@xmldom/xmldom`、`lodash`、`picomatch`、`undici`、`ws` 为高危；`@babel/core`、`brace-expansion`、`js-yaml`、`uuid` 为中危。
- 审计提示 `npm audit fix --force` 会为部分依赖树安装不兼容的 Expo 版本，因此在没有单独升级计划的情况下强制修复不可接受。

所需整改：
- 生成 `npm audit --json`，把每个有漏洞的包映射到其顶层所有者。
- 先应用不破坏的 lockfile/包更新。
- 对 Expo 拥有的传递依赖漏洞，在考虑 SDK/canary 变动之前，先检查最新的 SDK 57 兼容补丁路径。
- 记录未解决的公告及其运行时暴露：仅构建期、仅开发、生产 JS bundle、原生运行时，或服务端/web 运行时。

验收标准：
- `npm audit --omit=dev --audit-level=moderate` 要么通过，要么有一份已签入、经所有者批准并附暴露分析的例外清单。

### F-08 Medium：持久化的配置文件状态存在两套看似活跃的模型

证据：
- SQLite 迁移仍会创建遗留的 `subscriptions` 和 `subscription_configs` 表：`src/database/sqlite3.tsx:21-38` 和 `:70-87`。
- `useProfiles` 直接读写这些表，且包含硬编码的中文 UI 字符串和裸 console 错误：`src/hooks/use-profiles.ts:33-52`。
- 当前的前台导入改用 `ProfileStore.upsertByUrl`：`src/app/config/index.tsx` 中下载钩子附近。
- 配置文件列表 UI 在 `ScrollView` 内对 `subs` 做 map：`src/app/(tabs)/profile.tsx:161-215`。

为什么重要：
- 两套状态模型让迁移、刷新、删除和用户可见的配置文件列表更难推理。死代码还让术语和本地化违规继续存在。

所需整改：
- 确认 `useProfiles` 是否被运行时路由引用。若未使用，删除它并记录迁移状态。
- 如果遗留表必须为迁移而保留，把它们隔离在仅迁移用的辅助函数之后，并防止新的写入。
- 为单配置文件到多配置文件状态添加一次性迁移测试，并为活跃配置文件选择添加回归测试。

验收标准：
- 运行时配置文件 CRUD 有唯一的来源。
- 遗留表名仅在迁移兼容性需要处保留。

### F-09 Medium：UI 性能与 RN 最佳实践漂移

证据：
- 配置文件列表在 `ScrollView` 内渲染 map 出的行：`src/app/(tabs)/profile.tsx:161-215`。
- 空状态从 `react-native` 而非 `expo-image` 导入 `Image`：`src/components/ui/home/empty-state.tsx:7`。
- 动画代码大量使用 `.value`；示例包括 `src/app/(tabs)/index.tsx:237-241`、`src/components/ui/home/connect-button.tsx` 和 `src/components/ui/profiles/rotating-border.tsx`。
- 一些动画使用布局属性，例如 `src/app/(tabs)/index.tsx:86-103` 中的 width/left，以及 `src/components/ui/home/profile-summary-card.tsx:50-51` 中的进度条 width。

为什么重要：
- RN 0.86/React 19 时代的工具对渲染纯度和 shared-value 修改更严格。列表、图片和布局动画是移动端卡顿的常见来源。

所需整改：
- 把无界或会随用户增长的列表改为 `FlatList`、`BottomSheetFlatList`、FlashList 或其它虚拟化方案。
- 用 `expo-image` 渲染位图，除非有已记录的平台特定原因。
- 对每个布局动画分类：仅在测量确认安全时保留小的确定性效果；否则切换到 transform/opacity。
- 在批量重写 `.value` 之前审计 React Compiler 状态。

验收标准：
- 没有已知的无界数据列表用 `ScrollView` + `.map` 渲染。
- `npx expo lint` 不再标记 shared-value 不可变性问题。

### F-10 Medium：术语、权限和隐私文案需要清理

证据：
- `app.config.ts:18-19` 和 `app.config.ts:85-87` 在注释/权限文本中包含 App Store 禁用术语。
- 原生和 TS 桥接类型仍暴露包含协议/头术语的标识符名，例如 `fetchSubscription` 和 `subscriptionUserinfoHeader`；仅当桥接兼容性决定是明确的，才可保留它们。
- 应用声明了相机和音频权限：`app.config.ts:58-65`；为相机启用了 `recordAudioAndroid: true`：`app.config.ts:83-88`。

为什么重要：
- 项目对 App Store 审核有严格的术语规则。权限提示应只请求所需且在上下文中有解释的能力。

所需整改：
- 把用户可见的权限文案替换为 "config URL" / "profile" 措辞。
- 仅在更改会破坏桥接/API 契约处保留协议要求的名称；否则添加弃用计划。
- 确认 QR 扫描是否需要 `RECORD_AUDIO`；若未使用则移除。

验收标准：
- `rg -n "subscription|订阅|Subscription" app.config.ts src/lang src/app src/components src/hooks` 只返回 HTTP 头、迁移表名和桥接兼容性的已记录例外。
- Android 权限列表与实际运行时功能相符。

## 建议的实施顺序

1. 先修门禁：lint 错误和依赖分诊。这让后续 diff 更安全，并让每个后续步骤可衡量。
2. 解决桥接所有权：把 VPN/原生事件集中到 `VpnContext`，然后对齐 iOS/Android 的手动刷新持久化。
3. 加固网络路径：Android trust manager、共享回落策略、取消/超时测试，以及 URL/头脱敏。
4. 增加可追溯性：结构化事件 schema、flow ID、持久的最新失败状态、Bugsnag breadcrumb。
5. 简化状态和 UI 性能：清理遗留配置文件模型、虚拟化列表、`expo-image`、动画审计。

## 给下一个 Agent 的测试计划

- 始终运行：`npx tsc --noEmit`、`npm test`、`npx expo lint`、`npx expo-doctor@latest`、`npx expo install --check`，以及 `npm audit --omit=dev --audit-level=moderate`。
- 为 config 回落策略、配置文件头解析、TaskLog 脱敏/保留、桥接结果映射和活跃配置文件迁移添加纯测试。
- 添加以下手动设备检查：
  - Android 无效证书抓取失败。
  - Android/iOS 有效的 SNI-over-IP 抓取成功。
  - 带 `apply=1` 的 QR 导入：verify、stop、download、save、process、start。
  - 前台手动刷新后紧接应用前台同步：无重复的 TaskLog 条目。
  - VPN start 失败：可见错误、结构化日志、持久的最新失败、Bugsnag breadcrumb。
- 当原生桥接行为改变时，在 `make run-ios` / `make run-android` 之后运行 `make dev-smoke-ios` / `make dev-smoke-android`。

## 护栏

- 不要动无关的脏文件。审计时 `version.json` 已被修改。
- 不要提交真实的 `.env` 值、原始 config 主体、带查询字符串的完整配置文件 URL，或 allowlist 预映像。
- 没有单独的依赖升级计划就不要运行 `npm audit fix --force`。
- 不要添加新的状态库；持久的应用状态留在 SQLite/KV 中。
- 不要用一刀切的禁用来掩盖 lint 失败。

---

## 整改状态（2026-07-02 追加）

在分支 `dev` 上执行；子模块 `src/modules/expo-onebox` 推进 f7bb133 → d1911ee。
配套文档：`2026-07-02-audit-exceptions.md`（F-07/F-08 决定）、
`docs/claude/config-fetch-policy.md`（F-04 策略表）、
`docs/claude/terminology-exceptions.md`（F-10 登记）。

| 发现 | 状态 | 关键提交 | 备注 |
|---|---|---|---|
| F-01 VPN 桥接集中化 | **完成**（设备 smoke 待办） | c7a6907, 799a1b0, 0760891, b1a90c8, d8e9395, e39a922 | 上下文动作（类型化结果）+ node store + restart machine；验收 rg 无匹配；`vpn-restart.ts` 已删除；39 个新纯测试。 |
| F-02 手动刷新持久化 | **完成**（设备一致性探针待办） | 5f44f74（submodule）, 28edb26 | iOS 与 Android 对齐——手动结果绝不持久化；开发屏幕上有一致性探针行。 |
| F-03 Android TLS 信任 | **完成**（设备探针待办） | 0b60f1e（submodule）, 28edb26 | `systemDefaultTrustManager()` 替换了 no-op manager；主机名校验不变；已添加 TLS 探针卡片；gradle 编译已验证。 |
| F-04 抓取回落策略 | **完成**（已适配） | c0b9569, d1911ee（submodule）, 28edb26, 0c4ef5a | 死的 JS `fetchConfigWithFallback` 连同其唯一调用方一并删除（见 F-08）；策略表文档 + 可执行的 JS 镜像及表驱动测试；原生：取消绝不回落，墙钟统一为 30 s，token 统一。Kotlin 重定向差异记录为暂缓的遗留项。 |
| F-05 可观测性 | **完成**（设备检查待办） | 0c4ef5a, 509b856, 31deb50 | Flow 事件（[EVT]、flow=<id> 可 grep）串起 capture→…→apply；TaskLog 已脱敏（读取即擦除）+ flowId；持久的 LastFailure 在清日志后仍存活；Bugsnag breadcrumb/metadata（仅 id/code）；原生日志已脱敏。 |
| F-06 lint 门禁 | **完成** | 6796e77, 30ab3fa, + F-01 相关提交 | `npx eslint src`：33 → 0 错误，0 警告（每次提交单调下降）。绝不运行 `expo lint`（会重写 package.json）。 |
| F-07 npm audit | **完成** | 0c53287 | 各严重级别 20 → 0 条公告，含开发依赖；仅使用范围限定的 override；expo-doctor 20/20；prebuild 证明 xcode+uuid@11；例外日志已签入。 |
| F-08 双配置文件模型 | **完成** | c0b9569, 7112580 | 死的 `use-profiles.ts` 已删除；ProfileStore 纯核心 + 17 个测试（迁移、活跃选择回归）；遗留表迁移冻结并附理由。 |
| F-09 UI 性能 | **完成**（视觉 QA 待办） | d244150, bf74fac | 配置文件 + 路由规则已虚拟化（FlatList、玻璃分段、焦点安全表头）；expo-image 空状态；scaleX 进度填充；WipeSlot 裁剪记录为豁免。 |
| F-10 术语与权限 | **完成** | 71a32ea | 权限文案已修正；RECORD_AUDIO 已移除（prebuild 后已验证 manifest/plist）；i18n 键已重命名；例外登记 + 验收 grep 恰好停在已记录的命中处。桥接标识符按明确的四层契约决定保留。 |

### 整改后对抗性复审
对完整 diff 的 5 维度多 Agent 复审（每个发现由两名独立的怀疑者评判）
在 86c1ba5 中确认并修复了两处回归：start() 无守卫的权限阶段（类型化
结果契约违规 → 首页开关静默失败），以及 active-profile-card 中冻结的
到期倒计时（未加 key 的卡片永不重新挂载）。所有其它候选发现都被驳回。

### 未完成的手动设备清单（声明，而非宣称已完成）
1. iOS/Android 构建 + 运行（`make run-ios` / `make run-android`），然后 `make dev-smoke-ios` / `make dev-smoke-android`（Swift 改动目前仅通过 prebuild 做了编译验证）。
2. 连接/断开、Android 权限拒绝路径、节点切换 + 触感；mode/profile/rule/log-level 变更合并为一次重启。
3. QR/深链接导入 `apply=1` 端到端（stop→download→store→process→start→dismiss）；`apply=0`；未验证主机降级；应用途中退出不留下孤儿隧道。
4. 开发屏幕：Refresh Parity Probe PASS；TLS 探针第 1 行 FAIL-as-expected / 第 2 行 OK（两平台）；强制 start 失败后 LastFailure 卡片被填充，并在清日志后仍存活。
5. `make test-bg-worker` + `adb-logcat-bg`：每次后台运行恰好一条 auto TaskLog 条目，每次手动刷新一条 manual-direct；logcat 不显示完整加速 URL 或原始头；`flow=<id>` 串起导入各阶段。
6. 列表：配置文件下拉刷新/激活/编辑删除；路由规则搜索保持 TextInput 焦点；玻璃卡片接缝/阴影在明暗两种模式下的视觉 QA。
7. 全部 tab 的中英文走查（重命名后的 i18n 键）；Bugsnag 面板显示 breadcrumb/lastFailure metadata 且不含 URL。
