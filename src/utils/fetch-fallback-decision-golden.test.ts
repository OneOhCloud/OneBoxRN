import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { shouldFallbackToAccelerator, type FetchErrorKind } from './config-fetch-policy.ts';

// fetch → 加速代理回落决策的跨平台 golden 锁。shouldFallbackToAccelerator 是原生
// 状态机内联实现的那套策略的 JS 规范镜像；这里把它对与语言无关的
// golden/fetch-fallback-decision.json 做断言，使这份契约成为单一来源 —— 从原生
// fetcher 里抽取的决策谓词也能对它断言（即原生防漂移锁的共享参考）。

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
