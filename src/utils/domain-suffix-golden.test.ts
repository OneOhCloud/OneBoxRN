import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { hostnameSuffixCandidates } from './domain-suffix.ts';

// JS third of the hostname-suffix cross-platform golden lock (audit C2 / D3c-02).
// Loads the shared golden/domain-suffix.json (in the native submodule) — the same
// file the Kotlin (DomainSuffixTest) and Swift (DomainSuffixGoldenCheck) runners
// use — so all three suffix walks agree, including the empty-segment edge case.

const golden = JSON.parse(
    readFileSync(new URL('../modules/expo-onebox/golden/domain-suffix.json', import.meta.url), 'utf8'),
) as { cases: { hostname: string; candidates: string[] }[] };

describe('hostnameSuffixCandidates (cross-platform golden sample)', () => {
    for (const c of golden.cases) {
        it(`suffixes of ${JSON.stringify(c.hostname)}`, () => {
            assert.deepEqual(hostnameSuffixCandidates(c.hostname), c.candidates);
        });
    }
});
