import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { shouldFallbackToAccelerator, type FetchErrorKind } from './config-fetch-policy.ts';

// Cross-platform golden lock for the fetch → accelerator-fallback decision
// (audit C4 / D3c-01). shouldFallbackToAccelerator is the JS spec mirror of the
// policy the native state machines implement inline; this asserts it against the
// language-agnostic golden/fetch-fallback-decision.json, so the contract is one
// source a decision predicate extracted from the native fetchers can also assert
// against (the native drift-lock's shared reference).

const golden = JSON.parse(
    readFileSync(new URL('../modules/expo-onebox/golden/fetch-fallback-decision.json', import.meta.url), 'utf8'),
) as {
    cases: { kind: string; domainVerified: boolean; acceleratorConfigured: boolean; fallback: boolean; reason: string }[];
};

describe('shouldFallbackToAccelerator (cross-platform decision golden)', () => {
    for (const c of golden.cases) {
        it(`${c.kind} verified=${c.domainVerified} accel=${c.acceleratorConfigured} → fallback=${c.fallback}`, () => {
            const got = shouldFallbackToAccelerator(c.kind as FetchErrorKind, {
                domainVerified: c.domainVerified,
                acceleratorConfigured: c.acceleratorConfigured,
            });
            assert.equal(got.fallback, c.fallback);
            assert.equal(got.reason, c.reason);
        });
    }
});
