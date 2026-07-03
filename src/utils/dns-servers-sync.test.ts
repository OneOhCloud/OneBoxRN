import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

// Cross-platform consistency lock for the DNS probe server list (audit C7 / D3c-07).
// The same upstream DNS IPs are hardcoded in Kotlin (DnsTester.kt) and Swift
// (DnsTester.swift); this reads both plus golden/dns-servers.json and asserts the
// sets are identical, so a one-sided edit fails make test. No JS copy — JS resolves
// via expo/fetch. Same file-reading pattern as domain-allowlist-sync.test.ts.

function read(rel: string): string {
    return readFileSync(new URL(rel, import.meta.url), 'utf8');
}

const golden = JSON.parse(read('../modules/expo-onebox/golden/dns-servers.json')) as { servers: string[] };
const want = [...golden.servers].sort();

const IPV4 = /"(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})"/g;

const SOURCES: Record<string, string> = {
    kotlin: '../modules/expo-onebox/android/src/main/java/expo/modules/onebox/oneoh/cloud/helper/DnsTester.kt',
    swift: '../modules/expo-onebox/ios/core/DnsTester.swift',
};

describe('DNS probe server list cross-platform consistency (C7 / D3c-07)', () => {
    for (const [platform, rel] of Object.entries(SOURCES)) {
        const src = read(rel);
        it(`${platform}: DNS server set matches the golden`, () => {
            const ips = [...new Set([...src.matchAll(IPV4)].map(m => m[1]))].sort();
            assert.deepEqual(ips, want);
        });
    }
});
