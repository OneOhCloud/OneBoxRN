---
applies-to: app.config.ts, src/lang, src/app, src/components, src/hooks, src/database/sqlite3.tsx, src/modules/expo-onebox
loaded-when: 审查者标记出 App Store 禁用术语；任何触及术语验收 grep 的改动
updated-on: 2026-07-02 import-flow refactor (entries relocated from src/app/config/index.tsx)
---

# terminology-exceptions

## 规则
App Store 术语规则（CLAUDE.md）禁止在用户可见文本、i18n 键+值、标识符、注释和日志中使用
subscription/订阅 措辞。下列出现处是**唯一**获批准的例外。任何命中
验收 grep 却不在此列表中的新内容都是 blocker。

## 验收 grep
```
rg -n "subscription|订阅|Subscription" app.config.ts src/lang src/app src/components src/hooks
```
预期匹配：恰好是 § app-code exceptions 中的条目。

## app-code exceptions (inside the grep scope)
| 位置 | 术语 | 保留原因 |
|---|---|---|
| `src/hooks/import-flow-machine.ts`（`getHeader('subscription-userinfo')`，从 `src/app/config/index.tsx` 迁移而来） | `subscription-userinfo` | 标准 HTTP 响应头名称（协议规定，不能更改）。 |
| `src/hooks/import-flow-machine.test.ts`（2× `'subscription-userinfo'` 夹具头） | `subscription-userinfo` | 镜像该状态机所解析的协议头的测试夹具。 |

## grep 范围外的例外（为完整性而记录）
- **桥接表面**：不再有以 `subscription` 为前缀的标识符——
  `fetchSubscription` 桥接方法（→ `fetchProfileConfig`）以及
  `ConfigRefreshResult.subscription*` 结果字段（→ `profile{Upload,Download,
  Total,Expire,UserinfoHeader}`）已在 2026-07 审计整改中重命名。
- **协议字符串**：`'subscription-userinfo'` 字面量出现在 `src/utils.ts`
  （web mock）、`src/utils/profile-info.ts`（解析器）、
  `src/debug/import-tests/cases.ts`（流水线用例夹具）、Kotlin/Swift worker 中。
- **外部 URL**（服务端控制的路径，不能更改）：
  `https://www.sing-box.net/verified_subscriptions_sha256.txt`
  （`src/utils/domain-verification.ts`）。
- **迁移冻结的 SQL**：`src/database/sqlite3.tsx` 中的 `subscriptions` /
  `subscription_configs` 表名——已发布的 v0→1 迁移，无读者也无
  写者（见那里的 LEGACY 注释，以及
  `docs/audits/2026-07-02-audit-exceptions.md` 中的 F-08 决定）。
- **持久化 KV 键 `sub_ids` / `active_sub_id` / `sub_migration_v1` / `sub_<id>`**
  （`src/database/profile-store-core.ts`）：已安装设备上的配置文件存储键——
  重命名需要数据迁移，所以它们像 SQL 表一样被冻结。它们不是禁用术语
  （`sub` ≠ `subscription`），且在验收 grep 之外。（面向用户的 `sub_*` i18n 键与
  `SubInfo` 类型已在 2026-07 整改中重命名为 `profile_*` / `ProfileQuota`。）
- **审计文档**（`docs/audits/*`）出于必要引用了禁用术语。

## 动画例外（审计 F-09，记录于此以保持 grep 稳定）
- `src/app/(tabs)/index.tsx` 的 `WipeSlot` width/left 裁剪显现——本质上
  是裁剪动画，状态翻转罕见，由 UI 线程驱动；见内联注释。

## 已移除（不要重新引入）
- `RECORD_AUDIO` 权限 / `recordAudioAndroid: true`——应用中任何地方都不存在
  音频采集；QR 扫描仅用相机。
- 权限文案中的 "subscription links"；注释中的 订阅 措辞。
