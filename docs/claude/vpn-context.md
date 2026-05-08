---
applies-to: src/contexts/vpn-context.tsx, any consumer of ExpoOneBoxModule in UI / hooks / screens
loaded-when: reviewer flags direct ExpoOneBoxModule call from UI; investigator touches connect / disconnect / mode-switch / status-event flow
updated-on: bug
---

# vpn-context

## rule
UI writes to VPN state go through `VpnContext`. Never call `ExpoOneBoxModule` directly from a component / screen / hook for mutation.

## why
category: bug.
failure: multiple writers to native module race on connect/disconnect sequence. no single place for optimistic UI or state reconciliation. state diverges between JS cache and native truth when native emits asynchronously.
constraint: `ExpoOneBoxModule` mutation surface is accessed only inside `vpn-context`. Components dispatch intents (`startWithProfile`, `stop`, `setMode`); context owns the bridge call + reconciliation with native events.

## read-only exception
reading static info (`getStatus`, `isBackgroundConfigRefreshRegistered`, etc.) directly from `ExpoOneBoxModule` is acceptable in dev / debug surfaces (`src/app/config/dev.tsx`, `src/app/dev-smoke.tsx`, background task registrations). writes always via context.

## event emitter
native → JS events (`onStatusChange`, traffic updates, log lines) are subscribed once inside `vpn-context`. additional subscribers elsewhere = duplicate listeners + missed teardown on re-mount.
