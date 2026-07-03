# Audit Exceptions & Dependency Decisions — 2026-07-02

Companion to `2026-07-02-engineering-audit.md`. Records F-07 dependency decisions and
standing exceptions referenced by the audit's acceptance criteria.

## F-07 npm audit

Status after overrides: **0 open advisories** — both `npm audit --omit=dev --audit-level=moderate`
(the audit gate) and full `npm audit` (dev included).

Verification performed: `npm install` → both audits 0 → `npm ls` spot check →
`npx tsc --noEmit` → `npm test` (66 pass) → `npx expo-doctor` 20/20 →
`npx expo install --check` aligned → `make prebuild` succeeds (proves `xcode`+`uuid@11`) →
node smoke: `i18n-js` translates with `lodash@4.18.1`.

### Rejected remediations

- `npm audit fix --force` — would downgrade `expo` 57→46 and `expo-splash-screen` 57→55.
  Destructive; forbidden.
- Upgrading `expo` majors solely for transitive advisories — not needed; every advisory
  roots at an overridable leaf.

### Override decisions (risk log)

All entries in `package.json` `overrides`. "exposure" = where the vulnerable code could run.

| package | from → to | parent(s) | exposure | risk note |
|---|---|---|---|---|
| shell-quote | 1.8.3 → 1.8.4 | react-native → react-devtools-core | dev-time (devtools) | critical advisory; parent range `^1.6.1` satisfied |
| @xmldom/xmldom | 0.8.11 → 0.8.13 | @expo/plist, plist (via config-plugins) | prebuild-time | clears 5 high advisories + entire expo-chain xmldom branch |
| lodash | 4.17.23 → 4.18.1 | i18n-js | **production JS bundle** | only runtime-shipped override; node i18n smoke passed; device boot smoke in manual checklist |
| picomatch@^2.0.0 | 2.3.1 → 2.3.2 | micromatch, jest-util (metro chain) | build-time | range-scoped; picomatch@4 instances untouched |
| undici | 6.25.0 → 6.27.0 | @bugsnag/cli | build-time (sourcemap upload) | not the runtime Bugsnag SDK |
| ws@^7.0.0 | 7.5.10 → 7.5.11 | react-native, react-devtools-core, metro | dev-time (dev server) | range-scoped; ws@8.21.0 untouched |
| @babel/core | 7.29.0 → 7.29.7 | expo tooling | build-time | low severity |
| brace-expansion@^5.0.0 | 5.0.4 → 5.0.7 | config-plugins glob chain | build-time | range-scoped |
| brace-expansion@^1.0.0 | 1.1.12 → 1.1.13 | minimatch@3 (eslint chain) | dev-time | added beyond audit baseline (full-audit hygiene) |
| flatted | 3.3.4 → 3.4.2 | flat-cache (eslint chain) | dev-time | added beyond audit baseline (full-audit hygiene) |
| js-yaml@^4.0.0 | 4.1.1 → 4.2.0 | @expo/xcpretty, @eslint/eslintrc | build/dev-time | range-scoped |
| uuid (scoped under `xcode`) | 7.0.3 → 11.1.1 | xcode@3.0.1 | prebuild-time | major jump; xcode uses only CJS `uuid.v4()`, present in v11; `make prebuild` proof-gate passed |

### Open exceptions

(none — every advisory resolved without version-major risk to direct deps)

Template for future rows: advisory · package · exposure class
[build-time | dev-only | production JS | native runtime] · rationale · revisit-by date.

### Known non-issues (pre-existing, unrelated to overrides)

- `@bugsnag/expo` declares peer `expo ^55`, installed `expo 57` — Bugsnag's latest release
  is `55.0.0` (no SDK-57 line exists yet), and 55 works on 57 (dev-smoke bridge check
  passes). A nested `overrides["@bugsnag/expo"]` pins its `expo`/`expo-constants` peers to
  the root versions to silence the install warning (audit D6a-10). Drop the override when
  Bugsnag ships an SDK-57 line and bump the dependency.
- `npm ls ws` shows `@expo/ws-tunnel` (wants `^8.0.0`) deduped onto the v7 instance and
  flagged `invalid` — pre-existing hoisting quirk (present before overrides, then at
  7.5.10); `ws@8.21.0` also present in tree; dev-tunnel only.

### Maintenance rule

`expo lint` and `expo install --fix` can rewrite `package.json` and silently drop the
`overrides` block. Lint via `npx eslint`; after running any expo tooling, check
`git diff package.json`.

## F-08 legacy tables decision

`subscriptions` / `subscription_configs` (created by the v0→1 SQLite migration) are kept
**migration-frozen**: shipped migration steps are not rewritten, and the tables are provably
empty on every install (`git log -S` shows no shipped writer ever existed; the only
reader/writer, `use-profiles.ts`, was dead code deleted in this remediation). Runtime
profile CRUD lives exclusively in `ProfileStore` (`src/database/kv.ts`). See comments in
`src/database/sqlite3.tsx`. Table names are a documented terminology exemption
(`docs/claude/terminology-exceptions.md`).

## C15 cross-platform background-store key naming

The iOS App Group `UserDefaults` and the Android `SharedPreferences`
(`expo_onebox_background_config`) are **separate, never-interoperating stores** — each
platform only ever reads its own keys, never the other's. Their key names differ (iOS
`bg_`-prefixed: `bg_config_url`, `bg_accelerate_url`, `bg_last_result_json`, …; Android
unprefixed: `config_url`, `accelerate_url`, `last_result`, …) and their structure differs
(iOS stores the domain-verification cache as one atomic JSON blob
`bg_domain_verification_cache_json`; Android uses two separate keys). Aligning the names
would require a persisted-key migration on installed devices for **zero functional
benefit** — there is no cross-platform key sharing — so the per-platform naming is kept
as-is (audit C15). This is a **native runtime** exemption; revisit only if the two stores
are ever unified (e.g. behind a shared Go-side store).

## D3c-08 heterogeneous config fetcher (iOS NWConnection vs Android OkHttp)

The two `ConfigFetcher` implementations are **platform-native by necessity**, not
accidental duplication. The iOS side hand-rolls HTTP/1.1 over `NWConnection`
specifically to (a) resolve the host through a best-of-N DNS probe and connect to the
returned IP while keeping the original hostname as the TLS SNI — bypassing local DNS
poisoning, a core requirement for the app's censored-network users — and (b) accept a
gzip body that the accelerator returns without a `Content-Encoding` header. Android
gets the same behavior from OkHttp with a custom `Dns`. Go's `net/http` (and libbox's
already-bound `LibboxNewHTTPClient`, which wraps `http.Client`) exposes neither the
custom-resolver-plus-SNI split nor the header-less gzip path, so **reusing it would
regress the poisoning bypass**.

**Drift risk is mitigated, not ignored.** The two fetchers share the transport-neutral
`ConfigFetchResult` contract, and every pure/fragile piece is golden-locked against one
cross-platform spec: the fetch→accelerator decision (`golden/fetch-fallback-decision.json`
+ the JVM `FetchWithFallbackTest`), the DNS A-record parser (`golden/dns-arecord.json`),
the `subscription-userinfo` parser (`golden/userinfo.json`), and — new in this pass — the
iOS hand-written chunked-transfer decoder (`golden/http-chunked.json` + `HttpChunkedGoldenCheck`),
which is the single riskiest hand-rolled part OkHttp handles for Android.

**Full transport unification (one shared Go fetcher) is a scoped, deferred Batch-4
delivery**, not a surgical change: (1) `helper/Makefile`'s `build` target does
`rm -rf sing-box` and re-clones the pinned tag from GitHub every run, so the fetcher
cannot live inside sing-box — it needs a new **tracked** Go package plus a gomobile-bind
restructure to bundle it alongside the pristine clone; (2) that rebuild re-clones the
engine over the network and would break the working build if the clone fails; (3) the
Go fetcher must reproduce the best-DNS/SNI/header-less-gzip/redirect behavior exactly or
every user's config fetch breaks on both platforms; (4) that security-sensitive change
**requires iOS real-device regression** (per the repo's "Verified = observed on device"
rule), which is unavailable in this environment. Revisit when a Go-side network sink is
scheduled with device access. This is a **native runtime** exemption.
