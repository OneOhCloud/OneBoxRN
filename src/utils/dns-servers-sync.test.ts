import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

// DNS 探测服务器列表的跨平台一致性锁。同一批上游 DNS IP 被硬编码在 Kotlin
// (DnsTester.kt) 与 Swift (DnsTester.swift) 里；这里两个都读，外加
// golden/dns-servers.json，断言两个集合一致，因此单边改动会让 make test 失败。
// JS 无副本 —— JS 走 expo/fetch 解析。文件读取方式与 domain-allowlist-sync.test.ts 相同。

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
