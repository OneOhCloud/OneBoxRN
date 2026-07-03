import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

// web stub 没有原生 Libbox 二进制，因此硬编码了 sing-box 版本。单一事实来源是
// 模块 Makefile 里的 SING_BOX_TAG（由 gomobile 构建烤进真正的二进制）。本测试让
// 两者之间的任何漂移变成红色测试，而不是悄无声息的手工同步失败。

const MAKEFILE = 'src/modules/expo-onebox/helper/Makefile';
const WEB_STUB = 'src/modules/expo-onebox/src/ExpoOneBoxModule.web.ts';

function makefileSingBoxVersion(): string {
    const text = readFileSync(MAKEFILE, 'utf8');
    const m = text.match(/SING_BOX_TAG\s*=\s*"?v?([0-9]+\.[0-9]+\.[0-9]+)"?/);
    assert.ok(m, `SING_BOX_TAG not found in ${MAKEFILE}`);
    return m![1];
}

function webStubSingBoxVersion(): string {
    const text = readFileSync(WEB_STUB, 'utf8');
    const m = text.match(/WEB_STUB_SING_BOX_VERSION\s*=\s*'([0-9]+\.[0-9]+\.[0-9]+)'/);
    assert.ok(m, `WEB_STUB_SING_BOX_VERSION not found in ${WEB_STUB}`);
    return m![1];
}

describe('sing-box version sync', () => {
    it('web stub version equals the Makefile SING_BOX_TAG (bare)', () => {
        assert.equal(webStubSingBoxVersion(), makefileSingBoxVersion());
    });
});
