---
applies-to: app.config.ts, src/lang, src/app, src/components, src/hooks, src/database/sqlite3.tsx, src/modules/expo-onebox
loaded-when: reviewer flags an App Store banned term; any change touching the terminology acceptance grep
updated-on: 2026-07 F-10 remediation
---

# terminology-exceptions

## rule
The App Store Terminology Rules (CLAUDE.md) ban subscription/订阅 wording in
user-visible text, i18n keys+values, identifiers, comments and logs. The
occurrences below are the ONLY sanctioned exceptions. Anything new that hits
the acceptance grep and is not in this list is a blocker.

## acceptance grep
```
rg -n "subscription|订阅|Subscription" app.config.ts src/lang src/app src/components src/hooks
```
Expected matches: exactly the entries in § app-code exceptions.

## app-code exceptions (inside the grep scope)
| where | term | why it stays |
|---|---|---|
| `src/app/config/index.tsx` (`ExpoOneBox.fetchSubscription` call) | `fetchSubscription` | bridge method name — 4-layer contract (docs/claude/bridge-signature.md); renaming requires synchronized Kotlin/Swift/TS/Web edits + prebuild + device smoke. Explicit keep decision, 2026-07 audit. |
| `src/components/dev/tls-trust-probe-card.tsx` (2× `ExpoOneBox.fetchSubscription`) | `fetchSubscription` | same bridge method; dev-only probe surface. |
| `src/app/config/index.tsx` (`getHeader('subscription-userinfo')`) | `subscription-userinfo` | standard HTTP response header name (protocol, cannot change). |

## out-of-grep-scope exceptions (documented for completeness)
- **Bridge surface** (`src/modules/expo-onebox`, `src/tasks/config-refresh.ts`):
  `fetchSubscription`, `fetchSubscriptionWithFallback`, result fields
  `subscriptionUpload/Download/Total/Expire/UserinfoHeader` — same 4-layer
  contract rationale. Never user-visible.
- **Protocol strings**: `'subscription-userinfo'` literals in `src/utils.ts`
  (web mock), `src/utils/profile-info.ts` (parser), Kotlin/Swift workers.
- **External URL** (server-controlled path, cannot change):
  `https://www.sing-box.net/verified_subscriptions_sha256.txt`
  (`src/utils/domain-verification.ts`).
- **Migration-frozen SQL**: `subscriptions` / `subscription_configs` table
  names in `src/database/sqlite3.tsx` — shipped v0→1 migration, no readers or
  writers (see the LEGACY comment there and the F-08 decision in
  `docs/audits/2026-07-02-audit-exceptions.md`).
- **i18n keys prefixed `sub_`** (`sub_title`, `sub_delete`, …): "sub" reads as
  shorthand for the profile entity, values are compliant; not banned terms.
- **Audit documents** (`docs/audits/*`) quote banned terms by necessity.

## animation exemptions (audit F-09, recorded here for grep stability)
- `src/app/(tabs)/index.tsx` `WipeSlot` width/left clip reveal — intrinsically
  a clip animation, rare state flips, UI-thread driven; see the inline comment.

## removed (do not reintroduce)
- `RECORD_AUDIO` permission / `recordAudioAndroid: true` — no audio capture
  exists anywhere in the app; QR scanning is camera-only.
- "subscription links" in permission copy; 订阅 wording in comments.
