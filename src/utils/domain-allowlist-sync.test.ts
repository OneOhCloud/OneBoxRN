import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

// Cross-platform consistency lock for the compile-time domain allowlist
// (audit C2 / D3c-02). The same SHA256 suffix-hash list and remote URL are
// hardcoded in three places (JS / Kotlin / Swift). This reads all three sources
// plus golden/domain-allowlist.json and asserts they are byte-identical, so a
// change to one that the others don't mirror fails make test. Same file-reading
// pattern as sing-box-version-sync.test.ts — no native imports.

function read(rel: string): string {
    return readFileSync(new URL(rel, import.meta.url), 'utf8');
}

const golden = JSON.parse(read('../modules/expo-onebox/golden/domain-allowlist.json')) as {
    verifiedListUrl: string;
    knownDomainSha256List: string[];
};

const SOURCES: Record<string, string> = {
    js: './domain-verification.ts',
    kotlin: '../modules/expo-onebox/android/src/main/java/expo/modules/onebox/oneoh/cloud/helper/BackgroundConfigWorker.kt',
    swift: '../modules/expo-onebox/ios/core/BackgroundConfigRefresh.swift',
};

const HEX64 = /[0-9a-f]{64}/g;
const wantHashes = [...golden.knownDomainSha256List].sort();

describe('domain allowlist cross-platform consistency (C2 / D3c-02)', () => {
    for (const [platform, rel] of Object.entries(SOURCES)) {
        const src = read(rel);
        it(`${platform}: SHA256 allowlist matches the golden`, () => {
            const hashes = [...new Set(src.match(HEX64) ?? [])].sort();
            assert.deepEqual(hashes, wantHashes);
        });
        it(`${platform}: verified-list URL matches the golden`, () => {
            assert.ok(src.includes(golden.verifiedListUrl), `${platform} source is missing ${golden.verifiedListUrl}`);
        });
    }
});
