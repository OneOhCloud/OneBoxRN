import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

// 编译期域名白名单的跨平台一致性锁。同一份 sha256 后缀哈希列表与远程 URL
// 被硬编码在三处（JS / Kotlin / Swift）。这里读取全部三个来源外加
// golden/domain-allowlist.json，断言它们逐字节一致，因此改了其中一处而其他
// 未同步就会让 make test 失败。文件读取方式与 sing-box-version-sync.test.ts 相同
// —— 无原生 import。

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
