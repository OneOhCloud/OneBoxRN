---
applies-to: src/modules/expo-onebox/android/src/main/java/expo/modules/onebox/oneoh/cloud/helper/ConfigFetcher.kt, src/modules/expo-onebox/android/src/main/java/expo/modules/onebox/oneoh/cloud/helper/BackgroundConfigWorker.kt, src/modules/expo-onebox/ios/core/ConfigFetcher.swift, src/modules/expo-onebox/ios/core/BackgroundConfigRefresh.swift, src/tasks/config-refresh.ts, src/database/helper.ts, src/utils/config-fetch-policy.ts
loaded-when: any change to config fetching, accelerator fallback, refresh persistence, or fetch error handling on either platform
updated-on: 2026-07 F-03/F-04 remediation
---

# config-fetch-policy

## rule
Every config-fetch path follows ONE policy table. A divergence between platforms or
between foreground/background is a bug unless listed under exemptions.

## paths
- **K-FG** Kotlin `fetchSubscriptionWithFallback` (import screen via bridge `fetchSubscription`)
- **K-RM/K-BG** Kotlin `executeRefreshWith` (foreground `executeConfigRefreshNow` / WorkManager)
- **S-FG / S-RM / S-BG** Swift equivalents (`BackgroundConfigRefresh.swift`)
- **JS-T** template fetch (`src/database/helper.ts fetchRemoteTemplate`)
- **WEB** `src/utils.ts fetchWithTimeout` web branch (exemption: always mock success)

## policy table
| condition | policy |
|---|---|
| primary 2xx | success, `method=primary` |
| HTTP non-2xx | fail `HTTP_<code>`, **no fallback** (a reachable server answered) |
| wall-clock timeout | network-fault class → fallback if gates pass. Wall clock **30 s** both platforms (connect 15 / read 30 on Android) |
| TCP/TLS/network error | fallback if gates pass |
| custom-DNS resolution failure | retry the same attempt via system DNS (`fetchDirect` / hostname connect); not itself a fallback trigger |
| unverified domain | primary always allowed; **fallback denied** (`ACCELERATOR_SKIPPED`) |
| accelerator not configured | fail with the primary error (`ACCELERATOR_UNAVAILABLE`) |
| accelerator HTTP non-2xx / error | fail `primary=<e> accelerated=<e>`, `method=fallback` (`BOTH_FAILED`) |
| cancellation (coroutine cancel / BGTask expiry / user abort) | **distinct from timeout; never fallback.** Kotlin rethrows `CancellationException`; Swift checks `Task.isCancelled` → `CANCELLED` |
| empty/unparseable URL | `skipped` (Swift) / IllegalArgument (Kotlin, JS guards empty before calling) |
| redirects | follow ≤5 re-resolving per hop (Swift). Kotlin: OkHttp auto-redirect + SNI factory pins the original hostname → cross-host redirect fails closed via the hostname verifier. **Known divergence, deferred** |
| template fetch (JS-T) | 15 s timeout, returns null → KV cache → bundled fallback; never throws |

## trust (F-03)
The Android IP-dial+SNI path MUST pass `systemDefaultTrustManager()` to OkHttp's
`sslSocketFactory` — OkHttp validates the chain through the supplied manager; a
pass-through manager disables validation entirely. Hostname verification always runs
against the ORIGINAL hostname. iOS uses Network.framework with SNI only — no
`sec_protocol_options_set_verify_block`, full system trust. Never weaken either.

## vocabulary
- bridge `method`: `'primary' | 'fallback'` (all four bridge layers)
- `[CONFIG_LOAD] 方式=` tokens (native logcat/NSLog + JS log lines):
  `PRIMARY · HTTP_ERROR_NO_FALLBACK · FALLBACK_ACCELERATOR · DOMAIN_UNVERIFIED ·
  ACCELERATOR_SKIPPED · ACCELERATOR_UNAVAILABLE · BOTH_FAILED · CANCELLED`
- JS structured `errorCode` (`src/utils/config-fetch-policy.ts`, the executable mirror
  of this table): `TIMEOUT | DNS | NETWORK | TLS | HTTP_<n> | CANCELLED |
  UNVERIFIED_DOMAIN | ACCELERATOR_UNAVAILABLE | UNKNOWN`

## result-persistence contract (F-02)
The native last-result slot (iOS AppGroup `group.cloud.oneoh.networktools` key
`bg_last_result_json`; Android prefs `expo_onebox_background_config` key `last_result`)
is written by TRUE BACKGROUND runs only. Manual foreground refreshes return directly to
JS and are never persisted (duplicate-replay prevention). `getLastConfigRefreshResult`
is clear-on-read. Identical on both platforms.

## log redaction
Never log: full config URLs (path/query can carry tokens), full accelerated URLs, raw
`subscription-userinfo` header values, plaintext hostnames of user profiles. Allowed:
`summarizeAccelerateUrl(...)` form, 8-char host digests (`hostHash8` / `sha8=`), parsed
numeric userinfo summaries, domain SHA256 (allowlist digests are public by design).

## exemptions
- WEB mock always succeeds (no real network on web).
- JS-T logs its full template URL — compile-time app-owned host, not user data.
- Kotlin redirect divergence (see table) — documented residual, fix = manual redirect
  loop mirroring Swift.
