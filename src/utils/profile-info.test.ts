import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { parseProfileUserinfo } from './profile-info.ts';

// Cross-platform golden-sample lock for the `subscription-userinfo` header parser
// (audit C6 / D3c-03 / Batch 3). The samples live in the native submodule
// (src/modules/expo-onebox/golden/userinfo.json) so the Kotlin (ParseUserinfoTest)
// and Swift (ParseUserinfoTests) runners load the exact same file. This is the JS
// third of that trio: it asserts the JS reference parser against the single
// contract. Add or change cases in the JSON, never inline here.

interface UserinfoGolden {
    cases: {
        name: string;
        header: string | null;
        expect: { upload: number; download: number; total: number; expire: number };
    }[];
    knownDivergences: {
        name: string;
        header: string;
        expect: { js: { totalAtLeast: number } };
    }[];
}

const golden = JSON.parse(
    readFileSync(new URL('../modules/expo-onebox/golden/userinfo.json', import.meta.url), 'utf8'),
) as UserinfoGolden;

describe('parseProfileUserinfo (cross-platform golden sample)', () => {
    for (const c of golden.cases) {
        it(c.name, () => {
            assert.deepEqual(parseProfileUserinfo(c.header), c.expect);
        });
    }

    for (const d of golden.knownDivergences) {
        it(`known divergence — JS side: ${d.name}`, () => {
            // JS keeps a lossy large number where the native Int64 parsers overflow
            // to 0. This locks the JS half of the documented split; the Kotlin and
            // Swift runners assert total === 0 for the same input.
            assert.ok(
                parseProfileUserinfo(d.header).total >= d.expect.js.totalAtLeast,
                'JS keeps a (lossy) large number rather than 0',
            );
        });
    }
});
