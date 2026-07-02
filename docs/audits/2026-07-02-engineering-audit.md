# OneBoxRN Engineering Audit

Date: 2026-07-02

## Baseline

- Project baseline: `expo@^57.0.0`, `react-native@0.86.0`, `react@19.2.3`, `expo-router@~57.0.2`.
- Current official basis:
  - Expo SDK 57 targets React Native 0.86, React 19.2.3, React Native Web 0.21.0, and Node 22.13.x: https://docs.expo.dev/versions/latest/
  - React Native lists 0.86 as the latest stable release: https://reactnative.dev/versions
  - Expo recommends `npx expo-doctor@latest` for New Architecture dependency validation: https://docs.expo.dev/guides/new-architecture/
  - Expo Router is the recommended navigation approach for Expo projects: https://docs.expo.dev/develop/app-navigation/

## Verification Snapshot

| Check | Result | Notes |
| --- | --- | --- |
| `npx tsc --noEmit` | Pass | No output. |
| `npm test` | Pass | 66 tests, 7 suites, 0 failures. Node prints experimental type-stripping and module-type warnings. |
| `npx expo-doctor@latest` | Pass | 20/20 checks passed. Command loads `.env`; do not echo secret values in logs or reports. |
| `npx expo install --check` | Pass | Dependencies are aligned with Expo SDK. |
| `npx expo lint` | Fail | 33 errors, mostly React hook purity/immutability rules. |
| `npm audit --omit=dev --audit-level=moderate` | Fail | 20 production vulnerabilities: 1 low, 13 moderate, 5 high, 1 critical. |

## Findings

### F-01 Blocker: VPN bridge mutations are not centralized

Evidence:
- `src/hooks/use-home-screen.ts:56-69` calls `ExpoOneBox.stop`, Android permission APIs, and `ExpoOneBox.start` directly.
- `src/app/(tabs)/index.tsx:226-231` calls `ExpoOneBox.selectProxyNode` from the tab screen.
- `src/hooks/use-proxy-nodes.ts:63-64` triggers native URL tests and `src/hooks/use-proxy-nodes.ts:87-108` subscribes to `onGroupUpdate` outside `VpnContext`.
- `src/app/config/index.tsx:516-541` adds a direct `onStatusChange` listener and calls `ExpoOneBox.stop`; `src/app/config/index.tsx:573-611` calls permission APIs and `ExpoOneBox.start`.

Why it matters:
- `CLAUDE.md` and `docs/claude/vpn-context.md` define `VpnContext` as the sole VPN mutator and event owner. Multiple UI-level mutators make start/stop races, stale UI state, duplicate native listeners, and inconsistent error handling more likely.

Required remediation:
- Add explicit `VpnContext` actions for start, stop, restart, permission gating, node selection, and URL test triggering.
- Move `onGroupUpdate` ownership into `VpnContext` or document a read-only exception with a single shared subscription surface.
- Update UI hooks/routes to call context actions only. Dev/debug screens may keep documented diagnostic exceptions.

Acceptance criteria:
- `rg -n "ExpoOneBox\\.(start|stop|selectProxyNode|triggerURLTest|addListener)" src/app src/hooks src/components` returns only `VpnContext`, native/background utility exceptions, and documented dev probes.
- Start/stop/import flows still pass manual native smoke on iOS and Android.

### F-02 Blocker: Foreground config refresh persistence differs across platforms

Evidence:
- Android intentionally does not store manual refresh results: `src/modules/expo-onebox/android/src/main/java/expo/modules/onebox/oneoh/cloud/ExpoOneBoxModule.kt:640-645`.
- iOS stores the manual refresh result before returning it: `src/modules/expo-onebox/ios/ExpoOneBoxModule.swift:278-281`.
- JS already applies manual refresh results directly: `src/tasks/config-refresh.ts:117-119`.
- JS foreground sync reads and clears native last-result storage: `src/tasks/config-refresh.ts:129-136`.

Why it matters:
- On iOS, a manual foreground refresh can be applied directly and then later be replayed through `syncNativeResultToJS()`, producing duplicate TaskLog entries and potentially overwriting the intended distinction between manual and background results.

Required remediation:
- Align iOS with Android unless product intent explicitly requires persisted manual refresh results.
- Add a bridge parity test or smoke probe that calls `executeConfigRefreshNow`, then asserts `getLastConfigRefreshResult()` does not return that same manual result.

Acceptance criteria:
- Android and iOS document the same rule for manual foreground refresh storage.
- TaskLog records one manual entry per manual execution and one auto entry per actual background execution.

### F-03 High: Android custom TLS trust path needs security review

Evidence:
- Android builds a custom `SNISocketFactory` for IP-dialed HTTPS: `src/modules/expo-onebox/android/src/main/java/expo/modules/onebox/oneoh/cloud/helper/ConfigFetcher.kt:40-70`.
- The OkHttp `X509TrustManager` passed to `.sslSocketFactory(...)` has no-op `checkClientTrusted` and `checkServerTrusted`: `ConfigFetcher.kt:118-131`.
- The comments say system trust is enforced by the default SSL context, but OkHttp relies on the provided trust manager for certificate chain validation.
- iOS uses Network.framework TLS options and claims full system trust evaluation without manual overrides: `src/modules/expo-onebox/ios/core/ConfigFetcher.swift:42-49` and `:110-135`.

Why it matters:
- If the Android trust manager truly bypasses certificate chain validation, config fetching can be exposed to MITM attacks. This affects profile import and background refresh.

Required remediation:
- Replace the no-op trust manager with the platform default `X509TrustManager` and pass the same instance used by the default trust manager factory.
- Add a negative test/manual probe against a host with an invalid certificate and a positive test against a valid host requiring SNI.
- Do not weaken hostname verification; keep verification against the original hostname.

Acceptance criteria:
- Invalid certificate chain fails on Android.
- Valid certificate for the original hostname succeeds when connecting through a resolved IP with SNI.
- iOS and Android behavior is documented in the bridge/native fetcher notes.

### F-04 High: Config fetch fallback semantics are inconsistent and under-tested

Evidence:
- `fetchConfigWithFallback` documents that timeouts should fall back: `src/utils/profile-loader.ts:50-58` and `:113-119`.
- The primary fetch catch block rethrows `AbortError` before `isNetworkFault()` can trigger fallback: `src/utils/profile-loader.ts:162-170`.
- JS profile fetch uses 10s timeout: `src/utils/profile-loader.ts:147-152`.
- Remote template fetch uses a separate 15s timeout path and logs full template URL: `src/database/helper.ts:172-193`.
- Native fetcher uses 15s connect, 30s read, and 60s call timeouts: `ConfigFetcher.kt:129-135`.
- Web `fetchWithTimeout` always returns a mock success for every input: `src/utils.ts:105-113`.

Why it matters:
- Users can see different behavior depending on whether the flow uses JS foreground fetch, native foreground fetch, native background fetch, template fetch, or web. The documented fallback policy is not fully enforced.

Required remediation:
- Define one policy table for timeout, network error, DNS error, HTTP non-2xx, unverified domain, unavailable accelerator, and cancellation.
- Implement typed error labels shared by JS and native where practical.
- Keep cancellation distinct from timeout: user-initiated abort should not fallback; wall-clock timeout should follow the chosen policy.
- Add pure tests for `fetchConfigWithFallback` using injectable fetch/reachability hooks or extract the decision core.

Acceptance criteria:
- Test cases cover primary success, HTTP failure with no fallback, timeout fallback, DNS/network fallback, unverified-domain fallback denial, accelerator unavailable, accelerator HTTP failure, and caller cancellation.
- Foreground JS/native and background native logs use the same method/status vocabulary.

### F-05 High: Observability is useful but not structured enough for traceability

Evidence:
- Log entries are `{source, level, message, time}` only: `src/utils/log-sink.ts:21-27`.
- `jsLog` mirrors arbitrary prose strings to console and the in-memory ring buffer: `src/utils/log-sink.ts:143-166`.
- Config load logs include full original or accelerated URLs: `src/utils/profile-loader.ts:160` and `:212-214`.
- TaskLog stores primary URL, accelerated URL, and raw `subscription-userinfo` header: `src/database/kv.ts:340-361`; append happens in `src/tasks/config-refresh.ts:160-175`.
- Bugsnag is initialized but there is no visible breadcrumb/metadata taxonomy for config import, VPN start, refresh, or native bridge events: `src/app/_layout.tsx:32-36`.

Why it matters:
- The app has a good log sink, but future debugging still depends on prose searching. It also persists or displays sensitive operational details without a clear redaction contract.

Required remediation:
- Introduce structured event fields: `event`, `flowId`, `profileIdHash`, `platform`, `phase`, `status`, `method`, `durationMs`, and typed `errorCode`.
- Redact URLs by default. Store host hash, path hash, and host display only when user-visible debugging requires it.
- Keep raw headers out of durable logs unless explicitly redacted or stored under a dev-only flag.
- Add Bugsnag breadcrumbs for high-level decisions and Bugsnag metadata for last failure state, with no config body, token, URL query, or full header values.

Acceptance criteria:
- A failed QR/import/apply flow can be followed by one `flowId` from capture to verify, stop, download, store, process, start, and final UI outcome.
- Clearing the in-app log clears volatile logs but does not erase the latest durable failure summary needed for support.

### F-06 High: Lint gate is currently failing under React 19-era rules

Evidence:
- `npx expo lint` reports 33 errors.
- Main categories:
  - `react-hooks/set-state-in-effect`: `src/app/config/index.tsx:40`, `:417`, `:481`, `src/contexts/vpn-context.tsx:165`, `src/hooks/use-proxy-nodes.ts:75`, and others.
  - `react-hooks/refs`: `src/app/config/index.tsx:393`, `src/components/ui/home/node-list.tsx:67`, `:75`, `:82`, `:123`.
  - `react-hooks/immutability`: Reanimated shared-value writes in `src/components/ui/home/connect-button.tsx:253-254`, `src/components/ui/profiles/rotating-border.tsx:109`, `src/components/ui/tab-focus-animator.tsx:48-50`.
  - `react-hooks/purity`: `Date.now()` during render in `src/components/ui/profiles/active-profile-card.tsx:107`.

Why it matters:
- The project cannot meet its stated standard gate while these errors remain. Several findings also overlap with React Compiler and Reanimated best practices.

Required remediation:
- Split lint fixes into narrow batches: hook-derived initial state, ref access during render, Reanimated shared-value API, and impure render calls.
- For Reanimated 4 + potential React Compiler readiness, prefer `.get()`/`.set()` where supported and align with the project's compiler setting.
- Do not suppress these rules unless a documented Expo/RN/Reanimated incompatibility requires it.

Acceptance criteria:
- `npx expo lint` exits 0.
- Manual UI smoke confirms animated controls still behave correctly.

### F-07 High: Production dependency audit is failing

Evidence:
- `npm audit --omit=dev --audit-level=moderate` reports 20 vulnerabilities.
- Notable packages: `shell-quote` critical; high severity in `@xmldom/xmldom`, `lodash`, `picomatch`, `undici`, `ws`; moderate in `@babel/core`, `brace-expansion`, `js-yaml`, `uuid`.
- Audit suggests `npm audit fix --force` would install an incompatible Expo version for part of the tree, so force-fixing is not acceptable without a separate upgrade plan.

Required remediation:
- Generate `npm audit --json` and map each vulnerable package to its top-level owner.
- Apply non-breaking lockfile/package updates first.
- For Expo-owned transitive vulnerabilities, check the latest SDK 57-compatible patch path before considering SDK/canary movement.
- Document unresolved advisories with runtime exposure: build-time only, dev-only, production JS bundle, native runtime, or server/web runtime.

Acceptance criteria:
- `npm audit --omit=dev --audit-level=moderate` either passes or has a checked-in, owner-approved exception list with exposure analysis.

### F-08 Medium: Persistent profile state has two active-looking models

Evidence:
- SQLite migrations still create legacy `subscriptions` and `subscription_configs` tables: `src/database/sqlite3.tsx:21-38` and `:70-87`.
- `useProfiles` reads/writes those tables directly and contains hardcoded Chinese UI strings and raw console errors: `src/hooks/use-profiles.ts:33-52`.
- Current foreground import uses `ProfileStore.upsertByUrl` instead: `src/app/config/index.tsx` around the download hook.
- Profile list UI maps over `subs` inside a `ScrollView`: `src/app/(tabs)/profile.tsx:161-215`.

Why it matters:
- Two state models make migrations, refreshes, deletes, and user-visible profile lists harder to reason about. Dead code also keeps terminology and localization violations alive.

Required remediation:
- Confirm whether `useProfiles` is referenced by runtime routes. If unused, remove it and document migration state.
- If legacy tables must remain for migration, isolate them behind migration-only helpers and prevent new writes.
- Add a one-time migration test for single-profile to multi-profile state and a regression test for active profile selection.

Acceptance criteria:
- Runtime profile CRUD has one source of truth.
- Legacy table names remain only where migration compatibility requires them.

### F-09 Medium: UI performance and RN best-practice drift

Evidence:
- Profile list renders mapped rows inside `ScrollView`: `src/app/(tabs)/profile.tsx:161-215`.
- Empty state imports `Image` from `react-native` instead of `expo-image`: `src/components/ui/home/empty-state.tsx:7`.
- Animated code uses `.value` heavily; examples include `src/app/(tabs)/index.tsx:237-241`, `src/components/ui/home/connect-button.tsx`, and `src/components/ui/profiles/rotating-border.tsx`.
- Some animations use layout properties such as width/left in `src/app/(tabs)/index.tsx:86-103` and progress bar width in `src/components/ui/home/profile-summary-card.tsx:50-51`.

Why it matters:
- RN 0.86/React 19-era tooling is stricter about render purity and shared-value mutation. Lists, images, and layout animations are common sources of jank on mobile.

Required remediation:
- Convert unbounded or user-growing lists to `FlatList`, `BottomSheetFlatList`, FlashList, or another virtualizer.
- Use `expo-image` for bitmap rendering unless the platform-specific reason is documented.
- Classify each layout animation: keep small deterministic effects only when measured safe; otherwise switch to transform/opacity.
- Audit React Compiler status before bulk `.value` rewrites.

Acceptance criteria:
- No known unbounded data list renders with `ScrollView` + `.map`.
- `npx expo lint` no longer flags shared-value immutability issues.

### F-10 Medium: Terminology, permissions, and privacy text need cleanup

Evidence:
- `app.config.ts:18-19` and `app.config.ts:85-87` include banned App Store terms in comments/permission text.
- Native and TS bridge types still expose identifier names that include protocol/header terminology, for example `fetchSubscription` and `subscriptionUserinfoHeader`; these may be retained only if the bridge compatibility decision is explicit.
- The app declares camera and audio permissions: `app.config.ts:58-65`; `recordAudioAndroid: true` is enabled for camera: `app.config.ts:83-88`.

Why it matters:
- The project has strict terminology rules for App Store review. Permission prompts should only request capabilities that are needed and explained in context.

Required remediation:
- Replace user-visible permission copy with "config URL" / "profile" language.
- Keep protocol-required names only where changing them would break bridge/API contracts; otherwise add a deprecation plan.
- Confirm `RECORD_AUDIO` is required for QR scanning; remove if unused.

Acceptance criteria:
- `rg -n "subscription|订阅|Subscription" app.config.ts src/lang src/app src/components src/hooks` returns only documented exceptions for HTTP headers, migration table names, and bridge compatibility.
- Android permission list matches actual runtime features.

## Recommended Implementation Order

1. Fix the gates first: lint errors and dependency triage. This makes later diffs safer and keeps every follow-up measurable.
2. Resolve bridge ownership: centralize VPN/native events in `VpnContext`, then align iOS/Android manual refresh persistence.
3. Secure the network path: Android trust manager, shared fallback policy, cancellation/timeout tests, and URL/header redaction.
4. Add traceability: structured event schema, flow IDs, durable latest failure state, Bugsnag breadcrumbs.
5. Simplify state and UI performance: legacy profile model cleanup, virtualized lists, `expo-image`, animation audit.

## Test Plan for the Next Agent

- Always run: `npx tsc --noEmit`, `npm test`, `npx expo lint`, `npx expo-doctor@latest`, `npx expo install --check`, and `npm audit --omit=dev --audit-level=moderate`.
- Add pure tests for config fallback policy, profile header parsing, TaskLog redaction/retention, bridge result mapping, and active-profile migration.
- Add manual device checks for:
  - Android invalid-certificate fetch failure.
  - Android/iOS valid SNI-over-IP fetch success.
  - QR import with `apply=1`: verify, stop, download, save, process, start.
  - Foreground manual refresh followed by app foreground sync: no duplicate TaskLog entry.
  - VPN start failure: visible error, structured log, durable latest failure, Bugsnag breadcrumb.
- Run `make dev-smoke-ios` / `make dev-smoke-android` after `make run-ios` / `make run-android` when native bridge behavior changes.

## Guardrails

- Do not touch unrelated dirty files. At audit time, `version.json` was already modified.
- Do not commit real `.env` values, raw config bodies, full profile URLs with query strings, or allowlist preimages.
- Do not run `npm audit fix --force` without a separate dependency-upgrade plan.
- Do not add new state libraries; persistent app state stays in SQLite/KV.
- Do not paper over lint failures with blanket disables.

---

## Remediation Status (appended 2026-07-02)

Executed on branch `dev`; submodule `src/modules/expo-onebox` advanced f7bb133 → d1911ee.
Companion docs: `2026-07-02-audit-exceptions.md` (F-07/F-08 decisions),
`docs/claude/config-fetch-policy.md` (F-04 policy table),
`docs/claude/terminology-exceptions.md` (F-10 registry).

| finding | status | key commits | notes |
|---|---|---|---|
| F-01 VPN bridge centralization | **done** (device smoke pending) | c7a6907, 799a1b0, 0760891, b1a90c8, d8e9395, e39a922 | Context actions (typed results) + node store + restart machine; acceptance rg returns no matches; `vpn-restart.ts` deleted; 39 new pure tests. |
| F-02 manual refresh persistence | **done** (device parity probe pending) | 5f44f74 (submodule), 28edb26 | iOS aligned to Android — manual results never persisted; parity probe row on the dev screen. |
| F-03 Android TLS trust | **done** (device probes pending) | 0b60f1e (submodule), 28edb26 | `systemDefaultTrustManager()` replaces the no-op manager; hostname verification unchanged; TLS probe card added; gradle compile verified. |
| F-04 fetch fallback policy | **done** (adapted) | c0b9569, d1911ee (submodule), 28edb26, 0c4ef5a | Dead JS `fetchConfigWithFallback` deleted with its only caller (see F-08); policy table doc + executable JS mirror with table-driven tests; native: cancellation never falls back, wall clock aligned 30 s, tokens unified. Kotlin redirect divergence documented as deferred residual. |
| F-05 observability | **done** (device checks pending) | 0c4ef5a, 509b856, 31deb50 | Flow events ([EVT], flow=<id> greppable) thread capture→…→apply; TaskLog redacted (scrub-on-read) + flowId; durable LastFailure survives log clear; Bugsnag breadcrumbs/metadata (ids/codes only); native logs redacted. |
| F-06 lint gate | **done** | 6796e77, 30ab3fa, + F-01 commits | `npx eslint src`: 33 → 0 errors, 0 warnings (monotonic per commit). Never run `expo lint` (rewrites package.json). |
| F-07 npm audit | **done** | 0c53287 | 20 → 0 advisories at every severity, dev deps included; range-scoped overrides only; expo-doctor 20/20; prebuild proves xcode+uuid@11; exception log checked in. |
| F-08 dual profile models | **done** | c0b9569, 7112580 | Dead `use-profiles.ts` deleted; ProfileStore pure core + 17 tests (migration, active-selection regression); legacy tables migration-frozen with rationale. |
| F-09 UI performance | **done** (visual QA pending) | d244150, bf74fac | Profiles + routing-rules virtualized (FlatList, glass segmentation, focus-safe header); expo-image empty state; scaleX progress fill; WipeSlot clip documented as exemption. |
| F-10 terminology & permissions | **done** | 71a32ea | Permission copy fixed; RECORD_AUDIO removed (manifest/plist verified post-prebuild); i18n keys renamed; exception registry + acceptance grep at exactly the documented hits. Bridge identifiers kept per explicit 4-layer-contract decision. |

### Outstanding manual device checklist (declared, not claimed)
1. iOS/Android build + run (`make run-ios` / `make run-android`), then `make dev-smoke-ios` / `make dev-smoke-android` (Swift changes compile-verified only via prebuild so far).
2. Connect/disconnect, Android permission-deny path, node switch + haptic; mode/profile/rule/log-level changes coalesce to one restart.
3. QR/deep-link import `apply=1` end-to-end (stop→download→store→process→start→dismiss); `apply=0`; unverified-host downgrade; back-out mid-apply leaves no orphan tunnel.
4. Dev screen: Refresh Parity Probe PASS; TLS probe row 1 FAIL-as-expected / row 2 OK (both platforms); LastFailure card populated after a forced start failure and survives log clear.
5. `make test-bg-worker` + `adb-logcat-bg`: exactly one auto TaskLog entry per background run, one manual-direct per manual refresh; logcat shows no full accelerated URL or raw header; `flow=<id>` traces the import phases.
6. Lists: Profiles pull-to-refresh/activate/edit-delete; routing-rules search keeps TextInput focus; glass card seams/shadow visual QA in light+dark.
7. EN+ZH walkthrough of all tabs (renamed i18n keys); Bugsnag dashboard shows breadcrumbs/lastFailure metadata without URLs.
