# 审计例外与依赖决定 — 2026-07-02

`2026-07-02-engineering-audit.md` 的配套文档。记录 F-07 依赖决定，以及
审计验收标准所引用的长期例外。

## F-07 npm audit

使用 override 后的状态：**0 条未处理公告**——`npm audit --omit=dev --audit-level=moderate`
（审计门禁）与完整的 `npm audit`（含开发依赖）皆然。

已执行的验证：`npm install` → 两个 audit 均为 0 → `npm ls` 抽查 →
`npx tsc --noEmit` → `npm test`（66 通过）→ `npx expo-doctor` 20/20 →
`npx expo install --check` 对齐 → `make prebuild` 成功（证明 `xcode`+`uuid@11`）→
node smoke：`i18n-js` 用 `lodash@4.18.1` 正常翻译。

### 已否决的整改

- `npm audit fix --force`——会把 `expo` 从 57 降到 46、`expo-splash-screen` 从 57 降到 55。
  破坏性；禁止。
- 仅为传递依赖公告而升级 `expo` 大版本——不必要；每条公告都根源于一个可
  override 的叶子依赖。

### Override 决定（风险日志）

所有条目都在 `package.json` 的 `overrides` 中。"exposure"（暴露）= 有漏洞的代码可能运行的位置。

| 包 | from → to | 父依赖 | exposure | 风险说明 |
|---|---|---|---|---|
| shell-quote | 1.8.3 → 1.8.4 | react-native → react-devtools-core | 开发期（devtools） | 严重公告；父依赖范围 `^1.6.1` 满足 |
| @xmldom/xmldom | 0.8.11 → 0.8.13 | @expo/plist, plist（经 config-plugins） | prebuild 期 | 清除 5 条高危公告 + 整条 expo 链的 xmldom 分支 |
| lodash | 4.17.23 → 4.18.1 | i18n-js | **生产 JS bundle** | 唯一随运行时发布的 override；node i18n smoke 已通过；设备启动 smoke 在手动清单中 |
| picomatch@^2.0.0 | 2.3.1 → 2.3.2 | micromatch, jest-util（metro 链） | 构建期 | 范围限定；picomatch@4 实例不受影响 |
| undici | 6.25.0 → 6.27.0 | @bugsnag/cli | 构建期（sourcemap 上传） | 不是运行时的 Bugsnag SDK |
| ws@^7.0.0 | 7.5.10 → 7.5.11 | react-native, react-devtools-core, metro | 开发期（dev server） | 范围限定；ws@8.21.0 不受影响 |
| @babel/core | 7.29.0 → 7.29.7 | expo 工具链 | 构建期 | 低危 |
| brace-expansion@^5.0.0 | 5.0.4 → 5.0.7 | config-plugins glob 链 | 构建期 | 范围限定 |
| brace-expansion@^1.0.0 | 1.1.12 → 1.1.13 | minimatch@3（eslint 链） | 开发期 | 超出审计基线添加（完整 audit 卫生） |
| flatted | 3.3.4 → 3.4.2 | flat-cache（eslint 链） | 开发期 | 超出审计基线添加（完整 audit 卫生） |
| js-yaml@^4.0.0 | 4.1.1 → 4.2.0 | @expo/xcpretty, @eslint/eslintrc | 构建/开发期 | 范围限定 |
| uuid（限定在 `xcode` 下） | 7.0.3 → 11.1.1 | xcode@3.0.1 | prebuild 期 | 大版本跳跃；xcode 只用 CJS `uuid.v4()`，v11 中存在；`make prebuild` 证明门禁已通过 |

### 未决例外

（无——每条公告都已解决，且未给直接依赖带来大版本风险）

未来行的模板：advisory · package · exposure 类别
[build-time | dev-only | production JS | native runtime] · 理由 · 复查截止日期。

### 已知的非问题（既有，与 override 无关）

- `@bugsnag/expo` 声明 peer `expo ^55`，实际安装 `expo 57`——Bugsnag 最新发行版
  是 `55.0.0`（尚无 SDK-57 线），而 55 在 57 上可用（dev-smoke 桥接检查
  通过）。一个嵌套的 `overrides["@bugsnag/expo"]` 把它的 `expo`/`expo-constants` peer 固定到
  根版本，以消除安装警告（审计 D6a-10）。当 Bugsnag 发布 SDK-57 线时，去掉这个
  override 并升级该依赖。
- `npm ls ws` 显示 `@expo/ws-tunnel`（想要 `^8.0.0`）被 dedupe 到 v7 实例上并
  标为 `invalid`——既有的提升怪癖（在 override 之前就存在，当时为
  7.5.10）；树中也存在 `ws@8.21.0`；仅用于 dev-tunnel。

### 维护规则

`expo lint` 和 `expo install --fix` 会重写 `package.json` 并悄悄丢掉
`overrides` 块。用 `npx eslint` 做 lint；运行任何 expo 工具后，检查
`git diff package.json`。

## F-08 遗留表决定

`subscriptions` / `subscription_configs`（由 v0→1 SQLite 迁移创建）保持
**迁移冻结**：已发布的迁移步骤不重写，且这些表在每个安装上可证明
为空（`git log -S` 显示从未发布过任何写者；唯一的读者/写者
`use-profiles.ts` 是本次整改中删除的死代码）。运行时配置文件 CRUD 完全
存活于 `ProfileStore`（`src/database/kv.ts`）。见 `src/database/sqlite3.tsx` 中的注释。
表名是一条已记录的术语豁免（`docs/claude/terminology-exceptions.md`）。

## C15 跨平台后台存储键命名

iOS App Group 的 `UserDefaults` 与 Android 的 `SharedPreferences`
（`expo_onebox_background_config`）是**相互独立、从不互通的存储**——每个
平台只读自己的键，绝不读另一个平台的。它们的键名不同（iOS
以 `bg_` 为前缀：`bg_config_url`、`bg_accelerate_url`、`bg_last_result_json`……；Android
无前缀：`config_url`、`accelerate_url`、`last_result`……），结构也不同
（iOS 把域名验证缓存存为一个原子 JSON blob
`bg_domain_verification_cache_json`；Android 用两个独立的键）。对齐这些名称
需要在已安装设备上做一次持久化键迁移，却带来**零功能
收益**——不存在跨平台键共享——因此按平台各自的命名保持
原样（审计 C15）。这是一条**原生运行时**豁免；仅当两个存储将来
被统一（例如放到共享的 Go 侧存储之后）时才复查。

## D3c-08 异构 config fetcher（iOS NWConnection vs Android OkHttp）

两个 `ConfigFetcher` 实现是**出于必要而平台原生**，不是
偶然的重复。iOS 侧在 `NWConnection` 上手写 HTTP/1.1，
专门是为了 (a) 通过 best-of-N 的 DNS 探测解析主机、连接到
返回的 IP，同时保留原始主机名作为 TLS SNI——绕过本地 DNS
污染，这是该应用受审查网络用户的核心需求——以及 (b) 接受
加速器在没有 `Content-Encoding` 头的情况下返回的 gzip 主体。Android
用带自定义 `Dns` 的 OkHttp 获得相同行为。Go 的 `net/http`（以及 libbox
已绑定、封装 `http.Client` 的 `LibboxNewHTTPClient`）既不暴露
自定义解析器加 SNI 的拆分，也不暴露无头 gzip 路径，所以**复用它会让
污染绕过退化**。

**漂移风险被缓解，而非被忽视。** 两个 fetcher 共享传输中立的
`ConfigFetchResult` 契约，且每个纯/脆弱的部分都对一份跨平台规范做了
golden 锁定：fetch→加速器 决策（`golden/fetch-fallback-decision.json`
+ JVM `FetchWithFallbackTest`）、DNS A 记录解析器（`golden/dns-arecord.json`）、
`subscription-userinfo` 解析器（`golden/userinfo.json`），以及——本轮新增的——
iOS 手写的 chunked-transfer 解码器（`golden/http-chunked.json` + `HttpChunkedGoldenCheck`），
后者是 OkHttp 在 Android 上代为处理的、风险最高的单个手写部分。

**完整的传输统一（一个共享的 Go fetcher）是一项范围明确、被推迟的 Batch-4
交付**，不是外科式的小改：(1) `helper/Makefile` 的 `build` target 每次运行都会
`rm -rf sing-box` 并从 GitHub 重新克隆固定的 tag，所以 fetcher 不能住在
sing-box 内部——它需要一个新的**受追踪的** Go 包，加上一次 gomobile-bind
重构，以便与纯净克隆一起打包；(2) 那次重建会通过网络重新克隆引擎，
若克隆失败会破坏可用的构建；(3) Go fetcher 必须精确复现
best-DNS/SNI/无头 gzip/重定向 行为，否则每个用户在两个平台上的 config 抓取
都会失败；(4) 那项安全敏感的改动**需要 iOS 真机回归**（依据仓库的
"已验证 = 在设备上观察到"规则），而本环境不具备。等到有设备访问权限、
排期 Go 侧网络 sink 时再复查。这是一条**原生运行时**豁免。
