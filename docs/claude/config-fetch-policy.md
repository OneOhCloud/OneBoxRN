---
applies-to: src/modules/expo-onebox/android/src/main/java/expo/modules/onebox/oneoh/cloud/helper/ConfigFetcher.kt, src/modules/expo-onebox/android/src/main/java/expo/modules/onebox/oneoh/cloud/helper/BackgroundConfigWorker.kt, src/modules/expo-onebox/ios/core/ConfigFetcher.swift, src/modules/expo-onebox/ios/core/BackgroundConfigRefresh.swift, src/tasks/config-refresh.ts, src/database/helper.ts, src/database/config-template.ts, src/utils/config-fetch-policy.ts
loaded-when: 任一平台上对 config 抓取、加速器回落、刷新持久化或抓取错误处理的任何改动
updated-on: 2026-07 F-03/F-04 remediation
---

# config-fetch-policy

## 规则
每条 config 抓取路径都遵循同一张策略表。平台之间或前台/后台之间的任何差异都是 bug，除非列在豁免项里。

## 路径
- **K-FG** Kotlin `fetchProfileConfigWithFallback`（导入屏幕经桥接 `fetchProfileConfig`）
- **K-RM/K-BG** Kotlin `executeRefreshWith`（前台 `executeConfigRefreshNow` / WorkManager）
- **S-FG / S-RM / S-BG** Swift 对应实现（`BackgroundConfigRefresh.swift`）
- **JS-T** 模板抓取（`src/database/config-template.ts fetchRemoteTemplate`）
- **WEB** `src/utils.ts fetchWithTimeout` 的 web 分支（豁免：始终 mock 成功）

## 策略表
| 条件 | 策略 |
|---|---|
| primary 2xx | 成功，`method=primary` |
| HTTP 非 2xx | 失败 `HTTP_<code>`，**不回落**（可达的服务器已应答） |
| 墙钟超时 | 归为网络故障类 → 若通过关卡则回落。墙钟两平台均为 **30 s**（Android 上 connect 15 / read 30） |
| TCP/TLS/网络错误 | 若通过关卡则回落 |
| 自定义 DNS 解析失败 | 通过系统 DNS 重试同一次尝试（`fetchDirect` / 主机名连接）；本身不是回落触发条件 |
| 未验证域名 | primary 始终允许；**拒绝回落**（`ACCELERATOR_SKIPPED`） |
| 未配置加速器 | 以 primary 错误失败（`ACCELERATOR_UNAVAILABLE`） |
| 加速器 HTTP 非 2xx / 错误 | 失败 `primary=<e> accelerated=<e>`，`method=fallback`（`BOTH_FAILED`） |
| 取消（协程 cancel / BGTask 到期 / 用户中止） | **与超时不同；绝不回落。** Kotlin 重新抛出 `CancellationException`；Swift 检查 `Task.isCancelled` → `CANCELLED` |
| 空/无法解析的 URL | `skipped`（Swift）/ IllegalArgument（Kotlin；JS 在调用前拦截空值） |
| 2xx 但响应体未通过 config 内容校验（空 / 非 JSON / 非 JSON 对象） | JS 侧存储关卡（`validateConfigContent`）：导入报错 `invalid-content`，刷新的成功被降级为 `failed`——不持久化任何内容，引擎绝不会在损坏的 config 上重启。代码 `INVALID_CONTENT` |
| 重定向 | 每跳重新解析、最多跟随 5 次（Swift）。Kotlin：OkHttp 自动重定向 + SNI 工厂固定原始主机名 → 跨主机重定向会经主机名校验器 fail closed。**已知差异，暂缓处理** |
| 模板抓取（JS-T） | 15 s 超时，返回 null → KV 缓存 → 内置兜底；绝不抛出 |

## 信任（F-03）
Android 的 IP 直连+SNI 路径必须把 `systemDefaultTrustManager()` 传给 OkHttp 的
`sslSocketFactory`——OkHttp 通过所提供的 manager 校验证书链；一个透传的
manager 会完全禁用校验。主机名校验始终针对**原始**主机名进行。iOS 使用
Network.framework，仅带 SNI——不用 `sec_protocol_options_set_verify_block`，
完整的系统信任。两者都绝不能削弱。

## 词汇
- 桥接 `method`：`'primary' | 'fallback'`（全部四个桥接层）
- `[CONFIG_LOAD] method=` token（原生 logcat/NSLog + JS 日志行）：
  `PRIMARY · HTTP_ERROR_NO_FALLBACK · FALLBACK_ACCELERATOR · DOMAIN_UNVERIFIED ·
  ACCELERATOR_SKIPPED · ACCELERATOR_UNAVAILABLE · BOTH_FAILED · CANCELLED`
- JS 结构化 `errorCode`（`src/utils/config-fetch-policy.ts`，本表的可执行
  镜像）：`TIMEOUT | DNS | NETWORK | TLS | HTTP_<n> | CANCELLED |
  UNVERIFIED_DOMAIN | ACCELERATOR_UNAVAILABLE | INVALID_CONTENT | UNKNOWN`

## 结果持久化契约（F-02）
原生的最近结果槽（iOS AppGroup `group.cloud.oneoh.networktools` 的键
`bg_last_result_json`；Android prefs `expo_onebox_background_config` 的键
`last_result`）只由**真正的后台**运行写入。手动前台刷新直接返回给
JS，绝不持久化（防止重复回放）。`getLastConfigRefreshResult`
读取即清除。两平台一致。

## 日志脱敏
绝不记录：完整的 config URL（路径/查询可能携带 token）、完整的加速 URL、原始的
`subscription-userinfo` 头值、用户配置文件的明文主机名。允许：
`summarizeAccelerateUrl(...)` 形式、8 字符主机摘要（`hostHash8` / `sha8=`）、解析后的
数值型 userinfo 摘要、域名 SHA256（allowlist 摘要按设计是公开的）。

## 豁免
- WEB mock 始终成功（web 上没有真实网络）。
- JS-T 会记录其完整的模板 URL——那是编译期由应用自有的主机，不是用户数据。
- Kotlin 重定向差异（见表格）——已记录的遗留项，修复 = 手写一个
  镜像 Swift 的重定向循环。
