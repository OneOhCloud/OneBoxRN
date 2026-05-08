---
id: investigator-layout-flex-sibling-squeeze
agent: investigator
scope: project:OneBoxRN
category: layout
priority: normal
calls: 0
helpful: 0
last-used: null
tags: [flex-layout, scroll-sibling, platform-diff, rn]
---

## symptom

multi-element flex column; one or more children resize inversely with the size of content inside another child. visible on Android + iOS. commonly: filter-chip row compresses when section below expands; re-stretches when everything collapses.

## lesson

RN flex column default: `flexShrink: 1, flexGrow: 0, flexBasis: auto`. two shrinkable children negotiate space using intrinsic heights. if one child is a ScrollView with tall content, it starves the other children.

rule: at most 1 shrinkable child per flex column. pin all non-flexing siblings with `flexGrow: 0, flexShrink: 0`. the one flexible child gets `flex: 1`.

diagnostic shortcut: `git grep -n "ScrollView" <file>` → if 2+ ScrollView siblings share a column, that's the hypothesis.

## why model needs it

base model treats RN flex as if it were web CSS. web has intrinsic height from children's natural layout + overflow scroll is additive. RN's ScrollView is flex-shrinkable by default and competes with siblings for the parent's height — the opposite of how a naive reader assumes scroll regions behave.
