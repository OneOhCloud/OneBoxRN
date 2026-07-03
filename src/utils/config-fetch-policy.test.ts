import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    classifyFetchError,
    errorCodeFromMessage,
    errorCodeOf,
    shouldFallbackToAccelerator,
    validateConfigContent,
    type ConfigContentVerdict,
    type FetchErrorKind,
} from './config-fetch-policy.ts';

describe('classifyFetchError', () => {
    // ERROR_SIGNATURES 里每个特征分支各一行，让每个 substring / name / regex
    // 信号都被锁定，防止悄悄漂移。
    const cases: [{ name?: string; message?: string }, FetchErrorKind][] = [
        // cancelled —— 两种拼法
        [{ message: 'CANCELLED' }, 'cancelled'],
        [{ message: 'Job was cancelled' }, 'cancelled'],
        [{ message: 'operation was canceled' }, 'cancelled'],
        // timeout —— name 信号 + 两个 substring
        [{ name: 'AbortError' }, 'timeout'],
        [{ message: 'Request timed out' }, 'timeout'],
        [{ message: 'connect timeout elapsed' }, 'timeout'],
        // dns —— 每个 substring 单独测
        [{ message: 'DNS server unreachable' }, 'dns'],
        [{ message: 'name resolution error' }, 'dns'],
        [{ message: 'could not resolve host' }, 'dns'],
        // tls —— 每个 substring 单独测
        [{ message: 'certificate chain validation failed' }, 'tls'],
        [{ message: 'Trust anchor for certification path not found' }, 'tls'],
        [{ message: 'tls alert received' }, 'tls'],
        [{ message: 'SSL handshake aborted' }, 'tls'],
        // http —— 只有 4xx/5xx 匹配该 kind 的正则
        [{ message: 'HTTP 502' }, 'http'],
        [{ message: 'server returned HTTP 404' }, 'http'],
        [{ message: 'HTTP 302 redirect' }, 'unknown'],
        // network —— name 信号与 substring，各自单独测
        [{ name: 'TypeError', message: 'Network request failed' }, 'network'],
        [{ name: 'TypeError', message: 'boom' }, 'network'],
        [{ message: 'network is unreachable' }, 'network'],
        // 兜底
        [{ message: 'something else entirely' }, 'unknown'],
        [{}, 'unknown'],
    ];
    for (const [input, expected] of cases) {
        it(`${JSON.stringify(input)} → ${expected}`, () => {
            assert.equal(classifyFetchError(input), expected);
        });
    }
});

describe('errorCodeOf', () => {
    it('maps kinds to the shared vocabulary', () => {
        assert.equal(errorCodeOf('timeout'), 'TIMEOUT');
        assert.equal(errorCodeOf('dns'), 'DNS');
        assert.equal(errorCodeOf('network'), 'NETWORK');
        assert.equal(errorCodeOf('tls'), 'TLS');
        assert.equal(errorCodeOf('cancelled'), 'CANCELLED');
        assert.equal(errorCodeOf('unknown'), 'UNKNOWN');
    });

    it('http carries the status code when known', () => {
        assert.equal(errorCodeOf('http', 502), 'HTTP_502');
        assert.equal(errorCodeOf('http'), 'HTTP');
    });
});

describe('errorCodeFromMessage', () => {
    it('maps undefined / empty to undefined', () => {
        assert.equal(errorCodeFromMessage(undefined), undefined);
        assert.equal(errorCodeFromMessage(''), undefined);
    });

    it('extracts the HTTP status into the code', () => {
        assert.equal(errorCodeFromMessage('HTTP 403 from primary'), 'HTTP_403');
        assert.equal(errorCodeFromMessage('http 500'), 'HTTP_500');
    });

    it('classifies messages without a status by kind', () => {
        assert.equal(errorCodeFromMessage('network unreachable'), 'NETWORK');
        assert.equal(errorCodeFromMessage('request timed out'), 'TIMEOUT');
        assert.equal(errorCodeFromMessage('ssl handshake failed'), 'TLS');
        assert.equal(errorCodeFromMessage('No config content found'), 'UNKNOWN');
    });
});

describe('shouldFallbackToAccelerator (policy table rows)', () => {
    const ok = { domainVerified: true, acceleratorConfigured: true };

    it('timeout + verified + accelerator → fallback (network-fault)', () => {
        assert.deepEqual(shouldFallbackToAccelerator('timeout', ok), {
            fallback: true,
            reason: 'network-fault',
        });
    });

    it('network / dns / tls faults fall back when gates pass', () => {
        for (const kind of ['network', 'dns', 'tls', 'unknown'] as const) {
            assert.equal(shouldFallbackToAccelerator(kind, ok).fallback, true, kind);
        }
    });

    it('HTTP answers never fall back (a reachable server answered)', () => {
        assert.deepEqual(shouldFallbackToAccelerator('http', ok), {
            fallback: false,
            reason: 'http-no-fallback',
        });
    });

    it('cancellation never falls back, regardless of gates', () => {
        assert.deepEqual(shouldFallbackToAccelerator('cancelled', ok), {
            fallback: false,
            reason: 'cancelled',
        });
    });

    it('unverified domain denies fallback', () => {
        assert.deepEqual(
            shouldFallbackToAccelerator('timeout', { domainVerified: false, acceleratorConfigured: true }),
            { fallback: false, reason: 'unverified-domain' },
        );
    });

    it('missing accelerator denies fallback', () => {
        assert.deepEqual(
            shouldFallbackToAccelerator('network', { domainVerified: true, acceleratorConfigured: false }),
            { fallback: false, reason: 'accelerator-unavailable' },
        );
    });
});

describe('validateConfigContent', () => {
    const cases: [string, string, ConfigContentVerdict][] = [
        ['valid sing-box object', '{"outbounds":[]}', { ok: true }],
        ['object with whitespace', '  {"dns":{}}\n', { ok: true }],
        ['empty string', '', { ok: false, reason: 'empty' }],
        ['whitespace only', '  \n\t', { ok: false, reason: 'empty' }],
        // 被剥掉 Content-Encoding 的代理缺陷：gzip 魔数字节被当作文本解码 ——
        // 绝不能作为配置持久化。
        ['gzip bytes as text', '�', { ok: false, reason: 'not-json' }],
        ['truncated json', '{"outbounds":[', { ok: false, reason: 'not-json' }],
        ['yaml body', 'proxies:\n  - name: a\n', { ok: false, reason: 'not-json' }],
        ['top-level array', '[1,2]', { ok: false, reason: 'not-object' }],
        ['top-level null', 'null', { ok: false, reason: 'not-object' }],
        ['top-level scalar', '"ok"', { ok: false, reason: 'not-object' }],
    ];
    for (const [label, content, expected] of cases) {
        it(`${label} → ${expected.ok ? 'ok' : expected.reason}`, () => {
            assert.deepEqual(validateConfigContent(content), expected);
        });
    }
});
