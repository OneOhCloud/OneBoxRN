import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { hostnameSuffixCandidates } from './domain-suffix.ts';

// hostname 后缀跨平台 golden 锁的 JS 一方。加载共享的 golden/domain-suffix.json
// （在原生子模块里）—— 与 Kotlin (DomainSuffixTest) 和 Swift (DomainSuffixGoldenCheck)
// 运行器使用的是同一个文件 —— 使三方的后缀遍历一致，包括空段这一边界情形。

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
