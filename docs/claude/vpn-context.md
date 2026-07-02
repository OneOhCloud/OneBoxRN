---
applies-to: src/contexts/vpn-context.tsx, src/contexts/vpn/*, any consumer of ExpoOneBoxModule in UI / hooks / screens
loaded-when: reviewer flags direct ExpoOneBoxModule call from UI; investigator touches connect / disconnect / mode-switch / restart / node-selection / status-event flow
updated-on: 2026-07 F-01 remediation (actions centralized; vpn-restart.ts absorbed)
---

# vpn-context

## rule
UI writes to VPN state go through `VpnContext`. Never call `ExpoOneBoxModule` directly from a component / screen / hook for mutation.

## why
category: bug.
failure: multiple writers to native module race on connect/disconnect sequence. no single place for optimistic UI or state reconciliation. state diverges between JS cache and native truth when native emits asynchronously.
constraint: `ExpoOneBoxModule` mutation surface is accessed only inside `src/contexts/vpn-context.tsx` + `src/contexts/vpn/bridge.ts`. Components dispatch intents; the context owns the bridge call + reconciliation with native events.

## context actions (the intent surface)
| action | signature | semantics |
|---|---|---|
| `start` | `(options?: {timeoutMs?, signal?}) => Promise<StartResult>` | Android permission gate + `getProcessedConfig` + native start; optional wall-clock race; typed failures (`permission-denied` / `aborted` / `timeout` / `config-error` / `native-error`) — never throws |
| `stop` | `(options?: {timeoutMs?}) => Promise<StopResult>` | resolves on STOPPED event; outcomes `stopped` / `already-stopped` / `timeout` (default 10 s) / `stop-rejected` (+300 ms grace) |
| `requestRestart` | `() => void` | debounced (250 ms), in-flight-guarded, exactly-one-rerun restart with freshest config; no-op when tunnel is down |
| `selectNode` | `(tag) => Promise<SelectNodeResult>` | native select + optimistic current-node in the node store |
| `triggerNodeTests` | `() => void` | opens 12 s testing window + fires both group URL tests |
| `resetNodes` | `() => void` | clears node store (disconnect / profile switch) |
| `setMode` | `(mode) => void` | persists mode + `requestRestart()` |

Presentation stays in the UI layer: actions return typed results; callers map them to Alert / ErrorView / i18n.

## pure cores (node:test covered)
`src/contexts/vpn/`: `actions.ts` (start/stop/select + `stopAndAwaitStopped`, the single stop-wait implementation), `restart-machine.ts` (port of the former `src/utils/vpn-restart.ts` — do not reintroduce per-screen stop→start sequences), `node-store-core.ts` (group-update reducer + external store), `types.ts`, `core-log.ts`. All dependency-injected (`VpnBridge`/`TimerHost`/`VpnLogger`), imported with relative `.ts` paths, tested under `make test`.

## node state
Proxy-node list / current node / testing window live in the module-level node store (`src/contexts/vpn/node-store.ts`), read via `useProxyNodeState()` (`useSyncExternalStore`, log-sink pattern) so high-frequency group updates never re-render `useVpn` consumers. `src/hooks/use-proxy-nodes.ts` is a thin selector that only decides *when* to reset/trigger.

## read-only exception
reading static info (`getStatus`, `isBackgroundConfigRefreshRegistered`, `getLibBoxVersion`, `getStartConfig`, `fetchSubscription`, etc.) directly from `ExpoOneBoxModule` is acceptable in dev / debug surfaces (`src/app/config/dev.tsx`, `src/app/dev-smoke.tsx`), background task registrations (`src/tasks/config-refresh.ts`), and native utilities (`src/utils/domain-verification.ts` `setVerificationData`). writes to VPN state always via context. dev-surface write exception: `src/components/dev/log-level-card.tsx` calls `setCoreLogLevel` (log-filter setter, not VPN state).

## event emitter
native → JS events (`onStatusChange`, `onGroupUpdate`, traffic updates, log lines) are subscribed once inside `vpn-context`. additional subscribers elsewhere = duplicate listeners + missed teardown on re-mount. transient `onStatusChange` waits belong in `stopAndAwaitStopped` (context-internal), never in screens.

## acceptance grep
`rg -n "ExpoOneBox\.(start|stop|selectProxyNode|triggerURLTest|addListener)" src/app src/hooks src/components` must return no matches.
