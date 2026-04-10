# OneBoxRN — Claude Code Instructions

## Project Overview

React Native VPN management app built with Expo SDK 55 + Expo Router (file-based routing). Core engine: sing-box v1.13.0. Targets iOS, Android, and Web.

---

## App Store Terminology Rules (Critical)

**These rules exist to avoid App Store review rejections, especially around in-app purchase ambiguity.**

| Banned term | Required replacement |
|---|---|
| subscription / 订阅 | config / configuration / profile |
| subscription link / 订阅链接 | config URL / profile URL |
| subscribe / 订阅（动词） | import / add / load config |
| subscription list / 订阅列表 | profile list / config list |
| subscription info / 订阅信息 | profile info / config info |
| subscription update / 订阅更新 | config refresh / profile sync |

**Strictly prohibited in:** UI strings, i18n keys and values (`lang/en.json`, `lang/zh.json`), component/variable/function names, comments, log messages, and any user-visible text.

**Also avoid:** any wording that implies recurring payments, purchases, billing, or premium tiers — unless it is explicitly an in-app purchase flow reviewed and approved by Apple.

---

## Commands

> Always derive commands from the Makefile. Never guess or fabricate commands.

```bash
# Development
make run-ios               # iOS debug
make run-android           # Android debug
expo start --web           # Web dev server

# Prebuild (required after any native dependency change)
make prebuild              # All platforms
make prebuild-ios          # iOS only
make prebuild-android      # Android only

# Release builds
make ios-archive           # iOS App Store Archive
make android               # Android AAB

# Clean
make clean                 # Remove all build artifacts

# Lint
expo lint                  # ESLint (expo flat config)
```

---

## Architecture

### Directory Structure

```
src/
├── app/                   # Expo Router file-based routes (entry point)
│   ├── _layout.tsx        # Root layout (providers, theme, initialization)
│   ├── (tabs)/            # Bottom tab navigation
│   │   ├── index.tsx      # Home screen (VPN control)
│   │   ├── subscriptions.tsx  # Profile/config management
│   │   └── settings.tsx
│   └── config/            # Config / debug stack
├── components/ui/         # Feature UI components (grouped by screen)
├── contexts/              # React Context (VPN runtime state)
├── database/              # Data persistence (SQLite + KV store)
├── hooks/                 # Custom hooks (business logic)
├── modules/expo-onebox/   # Custom Expo native module (sing-box bridge)
├── lang/                  # i18n (en.json / zh.json)
├── tasks/                 # Background tasks
└── utils/                 # Utility functions
```

### State Management

| Layer | Mechanism | Scope |
|---|---|---|
| VPN runtime state | `VpnContext` (`src/contexts/vpn-context.tsx`) | connection status, traffic, logs, mode |
| Persistent config | SQLite KV store (`src/database/kv.ts`) | user prefs, rules, DNS |
| Profile data | expo-sqlite structured tables | profiles, profile_configs |
| Local UI state | Component state + custom hooks | modals, sheets, forms |

**Do not** introduce new state management libraries. MMKV is deprecated and being migrated to SQLite.

### Navigation

- Expo Router file-based routing with `typedRoutes` experiment enabled
- Bottom tabs: native on iOS / Material3 on Android / custom on Web
- Modals: QR scanner, URL import

---

## Tech Stack Rules

### React Native / Expo

- **Strict TypeScript:** no `any`, no `@ts-ignore`, no `as unknown as X`
- Platform divergence via `.ios.ts` / `.android.ts` files — never `Platform.OS` checks in shared logic
- Heavy computation off the JS thread (Worklets / Reanimated)
- Never assume iOS and Android behavior is identical

### Styling

- Follow the official Expo Tailwind guide: https://docs.expo.dev/guides/tailwind/
- Use **NativeWind v5** + **Tailwind CSS v4** (`@tailwindcss/postcss`) for cross-platform `className` props
- CSS-based configuration via `src/global.css` (Tailwind v4 — no `tailwind.config.js`)
- Theme colors via CSS variables and `useTheme()` hook — never hardcode color values
- Do not introduce new styling libraries

### Data Fetching

- Profile fetching: `src/utils/subscription-loader.ts`, with fallback acceleration proxy
- All `fetch` calls must use a 10-second timeout via `AbortController`
- Parse `subscription-userinfo` response header for traffic/expiry data

### Localization

- All user-visible strings must go through `i18n-js` (`src/lang/en.json` + `zh.json`)
- Never hardcode English or Chinese strings in components
- i18n keys must use neutral terminology — follow the terminology table above

### Versioning

- Single source of truth for version numbers: `version.json`
- Build scripts automatically sync to iOS Info.plist and Android Manifest

---

## Domain Rules (VPN-specific)

- **VPN state changes** must go through `VpnContext` methods — never call `ExpoOneBoxModule` directly from UI
- **sing-box config** changes must use the template system in `src/database/config.ts`
- **Native module** (`modules/expo-onebox`) changes require `make prebuild` before running
- **Background tasks** (config refresh) register only via iOS BGTaskScheduler / Android WorkManager — no JS timers

---

## Anti-Patterns

- No business logic in orchestration layers (layouts / screens) — extract to hooks
- No top-level `utils/`, `helpers/` grouping — organize by domain
- No `isLoading` / `isSubmitting` flags as the primary guard against double-submit — prefer idempotent API design
- Never fabricate sing-box config fields or ExpoOneBox native APIs — mark unknowns `// UNVERIFIED` and explain
- Never skip `make prebuild` after modifying native code

---

## Execution Evidence Template

Provide after every change:

```
Working Directory: /Users/huangzhiyi/projects/oneohProjects/OneBoxRN
Source: package.json / Makefile
Results:
  expo lint  → clean / N warnings
  TypeScript → 0 errors
```
