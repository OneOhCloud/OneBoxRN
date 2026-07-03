import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

// The web stub has no native Libbox binary, so it hard-codes the sing-box
// version. The single source of truth is SING_BOX_TAG in the module Makefile
// (baked into the real binaries by the gomobile build). This test makes any
// drift between the two a red test instead of a silent hand-sync failure.

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
