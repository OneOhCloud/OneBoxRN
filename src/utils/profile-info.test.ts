import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { parseProfileUserinfo } from './profile-info.ts';

// `subscription-userinfo` 头解析器的跨平台 golden 样本锁。样本放在原生子模块里
// (src/modules/expo-onebox/golden/userinfo.json)，好让 Kotlin (ParseUserinfoTest)
// 与 Swift (ParseUserinfoTests) 运行器加载完全相同的文件。这是这三方里的 JS 一方：
// 用它把 JS 参考解析器对同一份契约做断言。用例增改都在 JSON 里，绝不内联到这里。

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
            // 原生 Int64 解析器会溢出为 0，而 JS 保留一个有损的大数。这里锁定
            // 该差异中 JS 的一半；Kotlin 与 Swift 运行器对同一输入断言 total === 0。
            assert.ok(
                parseProfileUserinfo(d.header).total >= d.expect.js.totalAtLeast,
                'JS keeps a (lossy) large number rather than 0',
            );
        });
    }
});
