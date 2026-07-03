---
applies-to: src/utils/domain-verification.ts, src/utils/domain-suffix.ts, src/modules/expo-onebox/android/**/BackgroundConfigWorker.kt, src/modules/expo-onebox/ios/core/BackgroundConfigRefresh.swift
loaded-when: reviewer flags plaintext domain in any Claude-facing file; investigator touches apply=1 / accelerator fallback / BG refresh; implementer adds new auto-apply path
updated-on: new-convention
---

# domain-allowlist

## rule
`DEFAULT_KNOWN_DOMAIN_SHA256_LIST` (TS, `src/utils/domain-verification.ts`) + Kotlin + Swift mirrors hold sha256 digests of trusted domains/suffixes. **The pre-image (plaintext hostname) MUST NOT appear** in any source file, comment, test fixture, commit, PR description, log line, i18n string, or `CHANGELOG.md` — in this repo or the next-door OneBox Tauri repo.

## why
category: bug (security).
failure: pre-image leak turns the hash check into a publicly-documented string comparison. the allowlist plus the remote list from `sing-box.net` is the only gate between an attacker with an OneBoxRN build and the set of domains trusted enough to auto-apply (`apply=1` deep links, accelerator fallback).
constraint: hex digests are the entire public surface. reviewer flags any plaintext hint — variable name, test fixture, comment, commit body, CHANGELOG line — as a blocker.

## how to add a new trusted domain/suffix
1. compute sha256 offline (never in-session output, never "sha256 of X is Y" recipes in chat or commit bodies)
2. add hex digest to `KNOWN_DOMAIN_SHA256` + both native mirrors (Kotlin, Swift)
3. commit message describes as "expanded supported servers" — no hostname
4. update this doc's `updated-on` with reason category if the convention shifts

## suffix matching
`hostnameMatchesAllowlist` / `hostnameMatchesAnyAllowlist` approve the entire subtree when a parent-suffix hash is listed. order: shortest-suffix-first. contract: `src/utils/domain-suffix.test.ts`.

## pre-commit hook
if you catch yourself typing `// sha256("example.com")` in a comment or log — strip before saving. the hash self-documents its function; which subtree it approves is intentionally opaque.
