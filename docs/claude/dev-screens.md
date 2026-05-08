---
applies-to: src/app/dev-smoke.tsx, src/app/config/dev.tsx, src/components/dev/**, src/debug/smoke-imports/**, src/debug/import-tests/**
loaded-when: reviewer flags i18n / layout-flex; investigator touches flex column with multiple scroll siblings on these paths
updated-on: platform-diff
---

# dev-screens

## scope
dev-only diagnostics. deep-link entry (`oneoh-networktools://dev-smoke`). never reaches end users.

## i18n exemption
category: requirement-change.
hardcoded EN preferred for diagnostic clarity. reviewer skips i18n flag on these paths. see project CLAUDE.md § Localization.

## flex column rule (layout)
category: platform-diff.
failure: RN lets 2 shrinkable ScrollView siblings in a flex column fight — lower sibling's intrinsic content drives upper sibling's height. filter chips squeeze when GroupSection expands, stretch when all collapse.
constraint: at most 1 shrinkable child per flex column. pin non-flexing siblings with `flexGrow:0 + flexShrink:0`. content ScrollView gets `flex:1`.

## cost accepted
changing to 3-tier layout (banner / chips / content) requires re-checking every non-shrinkable sibling; banner wrapper currently content-sized and relies on implicit layout.

## smoke-import entries convention
every new runtime dep with a native side gets one entry in `src/debug/smoke-imports/entries.ts` in the same commit that adds the dep. entry body uses dynamic `await import('<pkg>')`, one representative call, never mutates observable state. see project CLAUDE.md § Native-import smoke check.
