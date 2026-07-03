import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveQRData, type QRDataLogger } from './qr-data.ts';

/**
 * 覆盖从 camera-qr.tsx 抽出的二维码识别核心（`./qr-data`）。
 * 扫描器组件本身会引入 expo-camera / expo-router，因此这里单独测试纯 parser。
 */

function createCapturingLogger(): QRDataLogger & { lines: string[] } {
    const lines: string[] = [];
    return {
        lines,
        debug: (m) => lines.push(`debug ${m}`),
        info: (m) => lines.push(`info ${m}`),
        warn: (m) => lines.push(`warn ${m}`),
    };
}

describe('resolveQRData', () => {
    it('accepts a scheme URL and carries the apply flag', () => {
        assert.deepEqual(
            resolveQRData('oneoh-networktools://config?data=aGVsbG8=&apply=1'),
            { data: 'aGVsbG8=', apply: '1' },
        );
    });

    it('accepts a scheme URL without an apply flag (apply undefined)', () => {
        assert.deepEqual(
            resolveQRData('oneoh-networktools://config?data=aGVsbG8='),
            { data: 'aGVsbG8=', apply: undefined },
        );
    });

    it('rejects a scheme URL whose data param is missing', () => {
        assert.equal(resolveQRData('oneoh-networktools://config?apply=1'), null);
    });

    it('rejects a scheme payload that is not a parseable URL', () => {
        // 端口越界：startsWith(SCHEME) 为真但 `new URL` 抛异常，用于覆盖 catch 分支。
        assert.equal(resolveQRData('oneoh-networktools://config:99999'), null);
    });

    it('base64-encodes a plain https URL into the data field', () => {
        const raw = 'https://example.com/path';
        assert.deepEqual(resolveQRData(raw), { data: btoa(raw) });
    });

    it('rejects payloads that are neither the scheme nor https', () => {
        assert.equal(resolveQRData('hello world, not a url'), null);
    });

    it('routes each decision branch through the injected logger', () => {
        const log = createCapturingLogger();
        resolveQRData('oneoh-networktools://config?data=aGVsbG8=&apply=1', log);
        assert.ok(log.lines.some((l) => l.includes('scheme match')));

        const httpsLog = createCapturingLogger();
        resolveQRData('https://example.com', httpsLog);
        assert.ok(httpsLog.lines.some((l) => l.includes('plain https URL')));

        const missLog = createCapturingLogger();
        resolveQRData('nonsense', missLog);
        assert.ok(missLog.lines.some((l) => l.includes('unrecognized payload')));
    });

    it('is silent by default (no logger required)', () => {
        assert.doesNotThrow(() => resolveQRData('https://example.com'));
    });
});
