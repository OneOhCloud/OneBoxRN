---
applies-to: app.config.ts, src/lang, src/app, src/components, src/hooks, src/database/sqlite3.tsx, src/modules/expo-onebox
loaded-when: reviewer flags an App Store banned term; any change touching the terminology acceptance grep
updated-on: 2026-07-02 import-flow refactor (entries relocated from src/app/config/index.tsx)
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
| `src/hooks/import-flow-machine.ts` (`getHeader('subscription-userinfo')`, moved from `src/app/config/index.tsx`) | `subscription-userinfo` | standard HTTP response header name (protocol, cannot change). |
| `src/hooks/import-flow-machine.test.ts` (2× `'subscription-userinfo'` fixture header) | `subscription-userinfo` | test fixture mirroring the protocol header the machine parses. |

## out-of-grep-scope exceptions (documented for completeness)
- **Bridge surface**: no `subscription`-prefixed identifiers remain — the
  `fetchSubscription` bridge method (→ `fetchProfileConfig`) and the
  `ConfigRefreshResult.subscription*` result fields (→ `profile{Upload,Download,
  Total,Expire,UserinfoHeader}`) were renamed in the 2026-07 audit remediation.
- **Protocol strings**: `'subscription-userinfo'` literals in `src/utils.ts`
  (web mock), `src/utils/profile-info.ts` (parser),
  `src/debug/import-tests/cases.ts` (pipeline-case fixture), Kotlin/Swift workers.
- **External URL** (server-controlled path, cannot change):
  `https://www.sing-box.net/verified_subscriptions_sha256.txt`
  (`src/utils/domain-verification.ts`).
- **Migration-frozen SQL**: `subscriptions` / `subscription_configs` table
  names in `src/database/sqlite3.tsx` — shipped v0→1 migration, no readers or
  writers (see the LEGACY comment there and the F-08 decision in
  `docs/audits/2026-07-02-audit-exceptions.md`).
- **Persisted KV keys `sub_ids` / `active_sub_id` / `sub_migration_v1` / `sub_<id>`**
  (`src/database/profile-store-core.ts`): profile storage keys on installed
  devices — renaming needs a data migration, so they are frozen like the SQL
  tables. Not banned terms (`sub` ≠ `subscription`), and outside the acceptance
  grep. (The user-facing `sub_*` i18n keys and the `SubInfo` type were renamed to
  `profile_*` / `ProfileQuota` in the 2026-07 remediation.)
- **Audit documents** (`docs/audits/*`) quote banned terms by necessity.

## animation exemptions (audit F-09, recorded here for grep stability)
- `src/app/(tabs)/index.tsx` `WipeSlot` width/left clip reveal — intrinsically
  a clip animation, rare state flips, UI-thread driven; see the inline comment.

## removed (do not reintroduce)
- `RECORD_AUDIO` permission / `recordAudioAndroid: true` — no audio capture
  exists anywhere in the app; QR scanning is camera-only.
- "subscription links" in permission copy; 订阅 wording in comments.
