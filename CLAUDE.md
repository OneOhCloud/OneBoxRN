# OneBoxRN — Claude Code Instructions

## Project Overview

React Native VPN app. Expo SDK 55 + Expo Router. Core engine: sing-box v1.13.0. Targets iOS, Android, Web.

---

## Standard gate

```bash
npx tsc --noEmit          # TypeScript: must print nothing
expo lint                 # ESLint: clean or only non-actionable warnings
make test                 # pure-TS test runner: all passing
```

Clean = all three exit 0, no new errors. Deviation must be named in return.

### File-length budget tolerance

≤ 1.3× brief's stated budget → no flag. ≥ 1.5× → mark as "concern" and require justification.

---

## Review flag categories

Project-specific review flags:

| flag | rule source § (this doc unless noted) | severity |
|---|---|---|
| direct `ExpoOneBoxModule` call from UI (must route via `VpnContext`) | docs/claude/vpn-context.md | blocker |
| bridge signature out of sync across Kotlin / Swift / TS / Web stub | docs/claude/bridge-signature.md | blocker |
| `elevation` combined with animated `opacity` or `transform` | docs/claude/comet-animation.md § Android shadow pitfall | blocker |
| App Store banned term in user-visible text, identifier, comment, or log | App Store Terminology Rules (below) | blocker |
| hardcoded user-visible string outside `src/app/dev-smoke.tsx` / `src/app/config/dev.tsx` subtrees | docs/claude/dev-screens.md § i18n exemption + Localization (below) | concern |
| sing-box libbox rebuild missing `-lresolv` (iOS) | docs/claude/sing-box-upgrade.md | blocker |
| plaintext domain / suffix pre-image in any Claude-facing file | docs/claude/domain-allowlist.md | blocker |
| new animated border violating comet-layer spec | docs/claude/comet-animation.md | concern |
| direct `fetch` (must use `import { fetch } from 'expo/fetch'`) | Tech Stack Rules → Data Fetching | concern |
| platform divergence via runtime `Platform.OS` in shared logic instead of `.ios.ts` / `.android.ts` | Tech Stack Rules → RN / Expo | concern |

---

## App Store Terminology Rules

| Banned | Replacement |
|---|---|
| subscription / 订阅 | config / configuration / profile |
| subscription link / 订阅链接 | config URL / profile URL |
| subscribe / 订阅（动词） | import / add / load config |
| subscription list / 订阅列表 | profile list / config list |
| subscription info / 订阅信息 | profile info / config info |
| subscription update / 订阅更新 | config refresh / profile sync |

Prohibited in: UI strings, i18n keys + values (`lang/en.json`, `lang/zh.json`), identifiers (component / variable / function), comments, log messages, any user-visible text.

Also avoid: wording implying recurring payments, purchases, billing, or premium tiers — unless explicitly an in-app-purchase flow approved by Apple.

---

## Project-specific rule docs

Machine-style docs under `docs/claude/`. Load them per `docs/claude/doc-index.json`.

| doc | scope |
|---|---|
| [domain-allowlist.md](docs/claude/domain-allowlist.md) | hash-as-secret rule, pre-image secrecy, how to add a trusted domain |
| [sing-box-upgrade.md](docs/claude/sing-box-upgrade.md) | Libbox static archive, -lresolv, Swift short names vs ObjC selectors, stale PCM, xcpretty caveat |
| [bridge-signature.md](docs/claude/bridge-signature.md) | 4-layer sync rule (Kotlin / Swift / TS / Web), add/remove sequence |
| [vpn-context.md](docs/claude/vpn-context.md) | VpnContext as sole mutator, read-only exceptions |
| [comet-animation.md](docs/claude/comet-animation.md) | layer stack, geometry, Android `elevation` pitfall, opacity vs thickness gradient |
| [dev-screens.md](docs/claude/dev-screens.md) | dev-smoke + config/dev i18n exemption, flex column rule, smoke-entries convention |
| [config-fetch-policy.md](docs/claude/config-fetch-policy.md) | canonical fetch/fallback policy table, trust rules, CONFIG_LOAD tokens, refresh persistence contract, log redaction |
| [terminology-exceptions.md](docs/claude/terminology-exceptions.md) | sanctioned exceptions to the terminology ban (bridge names, protocol header, frozen SQL), acceptance grep |

---

## Test-first cadence

Project restatement of `~/.claude/CLAUDE.md § Testing`. No GitHub Actions CI — local pass is the only gate.

### Terminology

- **test suite** — programmatic case set with pass/fail verdicts, designed to re-run. In this repo: combined `SMOKE_IMPORT_ENTRIES + IMPORT_TEST_CASES` on `/dev-smoke` + anything under `make test`.
- **dev-tools card** — card on developer screen (`src/app/config/dev.tsx`) exposing one ad-hoc probe/action. `DebugActionsCard`, `BackgroundTaskCard`, `PrimaryUrlTestCard` (`Test` suffix is a probe, not a suite).

Rule: new test cases → dev-smoke combined suite (not new card). New manual probes → cards. No mixing in one component.

### Harnesses

| layer | how |
|---|---|
| pure TS helpers | `make test` → `node --experimental-strip-types --test 'src/**/*.test.ts'` |
| android BG worker (manual) | `make test-bg-worker` (requires adb device + imported profile) |
| device UI / native module | only via `make run-ios` / `make run-android` on device — escape hatch |
| native-import smoke | `make dev-smoke-ios` / `make dev-smoke-android` after `make run-*` bundles |
| import-entry flow tests | auto-runs on `/dev-smoke` mount (same trigger as smoke check) |

### Cadence

write function → write test → `make test` pass → next step. required for all new pure helpers (parsers, decoders, hash glue, suffix/path, formatters). skip allowed for screen components with no business logic — must be declared, not silent.

New unit tests live next to module: `src/foo/bar.ts` → `src/foo/bar.test.ts`. Test module must be dependency-free of native imports (`expo-*`, `react-native`, `@/modules/*`) — node's type-stripping runner won't resolve them. Extract pure core into sibling file if needed; pattern: `src/utils/domain-suffix.ts` + `.test.ts`.

### Escape hatch

Device-only effects (`BGTaskScheduler` fire, VPN status transition, haptic, NativeEvent): per global escape-hatch rule — ask whether to add `scripts/tmp-*.sh` adb harness, defer to manual device-run, or record gap. Never claim "tested" from typecheck alone.

### Native-import smoke check

Deep link `oneoh-networktools://dev-smoke` mounts `src/app/dev-smoke.tsx` → auto-runs `src/debug/smoke-imports/entries.ts` — one bridge call per native-touching package.

Workflow (two terminals):
1. Terminal A: `make run-ios` / `make run-android`
2. Wait for Metro to print `iOS Bundled …ms` / `Android Bundled …ms`
3. Terminal B: `make dev-smoke-ios` / `make dev-smoke-android`

Rejected: auto-triggering (log-tailing with `script(1)`, Metro HTTP probe, `adb logcat` follow). Reason: each hit shell-timing or TTY-capture edge case on macOS. Manual Make helper: tab-completable + two keystrokes.

Purpose: catch Hermes+RN missing Node/browser APIs (historical: `crypto.subtle.digest` stranded QR import at "verify"). Not behaviour validation — only bridge reachability.

Convention: every new runtime dep with a native side → one smoke entry in the same commit.

| dep type | smoke entry |
|---|---|
| `expo-*`, `react-native-*`, `@/modules/*`, `@gorhom/*`, native turbo/nitro | yes |
| `@expo-google-fonts/*`, icon packs (possibly reach native font loader) | yes |
| pure JS (`i18n-js`, `jsonc-parser`, `tailwind-merge`, `nativewind`, …) | no — bundler-time failure |
| devDeps (`eslint`, `typescript`, `husky`, …) | no — not runtime |
| libs covered transitively | no |

Entry body rules:
- dynamic `await import('<pkg>')` (node test runner won't try to resolve natives)
- no state mutation: no `Clipboard.setStringAsync`, no `Haptics.impactAsync`, no notification schedule, no navigation
- one representative call / property read; "did it throw" is the only assertion
- fallback: `expect(!!mod.X, ...)` on a required export

Green row → proceed. Red/orange → usually "forgot `make prebuild`" or "package assumes JS engine API Hermes lacks".

### Import-entry flow tests

Appended to native-import suite on the same `/dev-smoke` page. Cases: `src/debug/import-tests/cases.ts`. Target: `QR → verify → stop → download → apply` entry chain (regression guard for Nov 2026 work). Uses `FakeVpnModule` + pure helpers — never touches real `ExpoOneBox` / `ProfileStore` / network. Groups: `import`, `parse`, `crypto`, `verify`, `apply` — per-group pass/total headers + filter chips on page.

### End-of-session curation

After task complete, list new tests + propose which belong in permanent `make test` target. Wait for user OK before wiring into `make/test.mk`.

---

## Commands

All via Makefile. Never fabricate.

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

## Architecture

### Directory structure

```
src/
├── app/                   # Expo Router file-based routes
│   ├── _layout.tsx        # root layout (providers, theme, init)
│   ├── (tabs)/            # bottom tab nav
│   │   ├── index.tsx      # home (VPN control)
│   │   ├── subscriptions.tsx  # profile/config management  (route name retained; see terminology rules)
│   │   └── settings.tsx
│   └── config/            # config / debug stack
├── components/ui/         # feature UI, grouped by screen
├── contexts/              # React Context (VPN runtime state)
├── database/              # SQLite + KV store
├── hooks/                 # business-logic hooks
├── modules/expo-onebox/   # native module (sing-box bridge)
├── lang/                  # i18n (en.json / zh.json)
├── tasks/                 # background tasks
└── utils/                 # utilities
```

### State management

| layer | mechanism | scope |
|---|---|---|
| VPN runtime | `VpnContext` (`src/contexts/vpn-context.tsx`) | connection status, traffic, logs, mode |
| persistent config | SQLite KV (`src/database/kv.ts`) | prefs, rules, DNS |
| profile data | `expo-sqlite` tables | profiles, profile_configs |
| local UI state | component state + hooks | modals, sheets, forms |

No new state libs. All persistent state via SQLite (`kvGet`/`kvSet`) + `expo-sqlite`.

### Navigation

- Expo Router file-based, `typedRoutes` experiment enabled
- bottom tabs: native on iOS / Material3 on Android / custom on Web
- modals: QR scanner, URL import

---

## Tech Stack Rules

### React Native / Expo

- strict TypeScript: no `any`, no `@ts-ignore`, no `as unknown as X`
- platform divergence via `.ios.ts` / `.android.ts` files — no runtime `Platform.OS` in shared logic
- heavy compute off JS thread (Worklets / Reanimated)
- iOS and Android behaviour never assumed identical
- single-platform bug → check platform-diff hypothesis first (most "ghosts" = compositor, not code)
- use `import { fetch } from 'expo/fetch'`, never global `fetch`. global RN fetch is XHR-polyfill with unreliable `AbortController`; timed-out requests surface as opaque `TypeError: Network request failed` instead of `AbortError`. expo/fetch is WinterCG-compliant and cancels native requests correctly.

### Shadow / elevation

See `docs/claude/comet-animation.md § Android shadow pitfall`. Summary: no `elevation` on any view participating in animated opacity / transform.

### Animation

See `docs/claude/comet-animation.md`. Any new animated border / loading indicator follows the comet layer spec.

### Styling

- official Expo Tailwind guide: https://docs.expo.dev/guides/tailwind/
- NativeWind v5 + Tailwind v4 (`@tailwindcss/postcss`) via `className`
- CSS-based config in `src/global.css` (no `tailwind.config.js` for Tailwind v4)
- theme colours via CSS variables + `useTheme()` hook — never hardcode
- do not use lines, dividers, hairlines, or border strokes to create visual hierarchy; use color and tonal contrast instead
- no new styling libs

### Data fetching

- profile fetching: `src/utils/profile-loader.ts` + fallback acceleration proxy
- all `fetch` calls: 10-second timeout via `AbortController`
- parse `subscription-userinfo` response header (HTTP header name — allowed despite terminology ban) for traffic/expiry

### Localization

- user-visible strings go through `i18n-js` (`src/lang/en.json` + `zh.json`)
- no hardcoded EN/ZH in components
- i18n keys use neutral terminology per App Store Terminology Rules
- exception: `src/app/dev-smoke.tsx` + `src/app/config/dev.tsx` + their children (dev-only, never ships user-visible) — see `docs/claude/dev-screens.md`

### Versioning

- single source: `version.json`
- build scripts auto-sync to iOS Info.plist + Android manifest

---

## Domain rules (VPN-specific)

- VPN state changes go through `VpnContext` — never direct `ExpoOneBoxModule` from UI. See `docs/claude/vpn-context.md`.
- sing-box config changes use template system in `src/database/config.ts`.
- native module (`src/modules/expo-onebox`) changes require `make prebuild` before running.
- background tasks (config refresh) register only via iOS BGTaskScheduler / Android WorkManager — no JS timers.

---

## Anti-patterns

- no business logic in orchestration layers (layouts / screens) — extract to hooks
- no top-level `utils/` / `helpers/` grouping — organize by domain
- no `isLoading` / `isSubmitting` as primary double-submit guard — prefer idempotent API
- no fabrication of sing-box config fields or `ExpoOneBox` APIs — `// UNVERIFIED` + explain
- never skip `make prebuild` after native change
