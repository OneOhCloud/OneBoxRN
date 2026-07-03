import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { sha256Hex } from './domain-suffix.ts';

// JS third of the SHA-256 hex golden-sample lock (audit C4 / Batch 3). Loads the
// shared golden/sha256.json (in the native submodule) — the same file the Kotlin
// (Sha256Test) and Swift (Sha256GoldenCheck) runners use — and asserts the JS
// sha256Hex against it. Locks the UTF-8 encoding + lowercase-hex formatting.

const golden = JSON.parse(
    readFileSync(new URL('../modules/expo-onebox/golden/sha256.json', import.meta.url), 'utf8'),
) as { cases: { input: string; hex: string }[] };

describe('sha256Hex (cross-platform golden sample)', () => {
    for (const c of golden.cases) {
        it(`sha256(${JSON.stringify(c.input)})`, async () => {
            assert.equal(await sha256Hex(c.input), c.hex);
        });
    }
});
