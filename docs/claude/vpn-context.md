---
applies-to: src/contexts/vpn-context.tsx, src/contexts/vpn/*, any consumer of ExpoOneBoxModule in UI / hooks / screens
loaded-when: 审查者标记 UI 直接调用 ExpoOneBoxModule；调查者触及 connect / disconnect / mode-switch / restart / node-selection / status-event 流程
updated-on: 2026-07 F-01 remediation (actions centralized; vpn-restart.ts absorbed)
---

# vpn-context

## 规则
UI 对 VPN 状态的写入都经由 `VpnContext`。绝不从组件 / 屏幕 / hook 直接调用 `ExpoOneBoxModule` 进行修改。

## 为什么
category: bug.
failure: 多个写入者对原生模块的操作会在 connect/disconnect 序列上发生竞争。乐观 UI 或状态协调没有统一的落点。当原生异步发出事件时，JS 缓存与原生真实状态之间会发生偏离。
constraint: `ExpoOneBoxModule` 的修改表面只在 `src/contexts/vpn-context.tsx` + `src/contexts/vpn/bridge.ts` 内部访问。组件派发意图；上下文拥有桥接调用 + 与原生事件的协调。

## 上下文动作（意图表面）
| 动作 | 签名 | 语义 |
|---|---|---|
| `start` | `(options?: {timeoutMs?, signal?}) => Promise<StartResult>` | Android 权限关卡 + `getProcessedConfig` + 原生 start；可选的墙钟竞速；类型化失败（`permission-denied` / `aborted` / `timeout` / `config-error` / `native-error`）——绝不抛出 |
| `stop` | `(options?: {timeoutMs?}) => Promise<StopResult>` | 在 STOPPED 事件时 resolve；结果 `stopped` / `already-stopped` / `timeout`（默认 10 s）/ `stop-rejected`（+300 ms 宽限） |
| `requestRestart` | `() => void` | 去抖（250 ms）、带在途守卫、以最新 config 恰好重跑一次的重启；隧道关闭时为 no-op |
| `selectNode` | `(tag) => Promise<SelectNodeResult>` | 原生 select + 在 node store 中乐观更新当前节点 |
| `triggerNodeTests` | `() => void` | 打开 12 s 测试窗口 + 触发两个 group 的 URL 测试 |
| `resetNodes` | `() => void` | 清空 node store（断开 / 切换配置文件） |
| `setMode` | `(mode) => void` | 持久化模式 + `requestRestart()` |

呈现层留在 UI 层：动作返回类型化结果；调用方把它们映射到 Alert / ErrorView / i18n。

## 纯核心（node:test 覆盖）
`src/contexts/vpn/`：`actions.ts`（start/stop/select + `stopAndAwaitStopped`，唯一的 stop 等待实现）、`restart-machine.ts`（原 `src/utils/vpn-restart.ts` 的移植——不要重新引入按屏幕各自的 stop→start 序列）、`node-store-core.ts`（group-update reducer + 外部 store）、`types.ts`、`core-log.ts`。全部依赖注入（`VpnBridge`/`TimerHost`/`VpnLogger`），用相对 `.ts` 路径导入，在 `make test` 下测试。

## 节点状态
代理节点列表 / 当前节点 / 测试窗口存放在模块级 node store（`src/contexts/vpn/node-store.ts`），通过 `useProxyNodeState()`（`useSyncExternalStore`，log-sink 模式）读取，因此高频的 group 更新绝不会重新渲染 `useVpn` 的消费者。`src/hooks/use-proxy-nodes.ts` 是一个只决定*何时*重置/触发的轻量选择器。

## 上下文之外的桥接访问（非 VPN 状态）
这条约束规则范围很窄：只有 VPN 运行时状态的修改——`start`、`stop`、`selectProxyNode`、`triggerURLTest`，以及事件 `addListener`——必须经由 `VpnContext`。那正是下面验收 grep 所强制的集合。

其余每个桥接方法都不是 VPN 状态修改，可以在其所属之处直接调用——包括生产环境的初始化代码、屏幕、hooks 和后台任务。这是一条能力规则，不是位置白名单；下面列举的调用点是示例，并非穷举。当前获批准的直接调用方：
- 读取：`getStatus`（`src/app/_layout.tsx`）、`getLibBoxVersion`（`src/app/(tabs)/settings.tsx`、`src/utils.ts`）、`fetchProfileConfig`（`src/hooks/use-import-flow.ts`）、`getBestDns`（`src/database/helper.ts`），以及开发界面上的静态读取（`src/app/config/dev.tsx`、`src/app/dev-smoke.tsx`）和 BG 任务注册（`src/tasks/config-refresh.ts`）。
- 非 VPN 状态的一次性初始化写入：`copy2CacheDbPath` / `repairSQLiteDirectory`（`src/database/sqlite3.tsx`）、`checkBatteryOptimizationExemption` / `requestBatteryOptimizationExemption`（`src/app/_layout.tsx`）、`setCoreLogLevel`（日志过滤器 setter；位于 `src/contexts/vpn-context.tsx` 和开发用的 `src/components/dev/log-level-card.tsx`）、`setVerificationData`（`src/utils/domain-verification.ts`）。

在不显而易见的调用点加一行说明理由的注释。验收 grep——而非本列表——是唯一的强制门禁；当修改表面变化时，保持它是最新的。

## 事件发射器
原生 → JS 事件（`onStatusChange`、`onGroupUpdate`、流量更新、日志行）在 `vpn-context` 内部只监听一次。在别处再添加监听者 = 重复监听器 + 重新挂载时漏掉清理。瞬态的 `onStatusChange` 等待属于 `stopAndAwaitStopped`（上下文内部），绝不放在屏幕里。

## 验收 grep
`rg -n "ExpoOneBox\.(start|stop|selectProxyNode|triggerURLTest|addListener)" src/app src/hooks src/components` 必须无匹配。
