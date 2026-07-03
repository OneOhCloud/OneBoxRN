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
    // One row per signature branch in ERROR_SIGNATURES, so every substring /
    // name / regex signal is locked against silent drift.
    const cases: [{ name?: string; message?: string }, FetchErrorKind][] = [
        // cancelled — both spellings
        [{ message: 'CANCELLED' }, 'cancelled'],
        [{ message: 'Job was cancelled' }, 'cancelled'],
        [{ message: 'operation was canceled' }, 'cancelled'],
        // timeout — name signal + both substrings
        [{ name: 'AbortError' }, 'timeout'],
        [{ message: 'Request timed out' }, 'timeout'],
        [{ message: 'connect timeout elapsed' }, 'timeout'],
        // dns — each substring in isolation
        [{ message: 'DNS server unreachable' }, 'dns'],
        [{ message: 'name resolution error' }, 'dns'],
        [{ message: 'could not resolve host' }, 'dns'],
        // tls — each substring in isolation
        [{ message: 'certificate chain validation failed' }, 'tls'],
        [{ message: 'Trust anchor for certification path not found' }, 'tls'],
        [{ message: 'tls alert received' }, 'tls'],
        [{ message: 'SSL handshake aborted' }, 'tls'],
        // http — only 4xx/5xx match the kind regex
        [{ message: 'HTTP 502' }, 'http'],
        [{ message: 'server returned HTTP 404' }, 'http'],
        [{ message: 'HTTP 302 redirect' }, 'unknown'],
        // network — name signal and substring, each in isolation
        [{ name: 'TypeError', message: 'Network request failed' }, 'network'],
        [{ name: 'TypeError', message: 'boom' }, 'network'],
        [{ message: 'network is unreachable' }, 'network'],
        // fallthrough
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
        // The stripped-Content-Encoding proxy defect: gzip magic bytes
        // decoded as text — must never persist as a config.
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
