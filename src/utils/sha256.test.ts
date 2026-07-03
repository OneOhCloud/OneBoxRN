import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { sha256Hex } from './domain-suffix.ts';

// SHA-256 十六进制 golden 样本锁的 JS 一方。加载共享的 golden/sha256.json
// （在原生子模块里）—— 与 Kotlin (Sha256Test) 和 Swift (Sha256GoldenCheck) 运行器
// 使用的是同一个文件 —— 并据此断言 JS 的 sha256Hex。锁定 UTF-8 编码 + 小写十六进制格式。

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
