import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    classifyFetchError,
    errorCodeOf,
    shouldFallbackToAccelerator,
    type FetchErrorKind,
} from './config-fetch-policy.ts';

describe('classifyFetchError', () => {
    const cases: [{ name?: string; message?: string }, FetchErrorKind][] = [
        [{ name: 'AbortError' }, 'timeout'],
        [{ message: 'Request timed out' }, 'timeout'],
        [{ name: 'TypeError', message: 'Network request failed' }, 'network'],
        [{ message: 'DNS resolution failed: no servers' }, 'dns'],
        [{ message: 'could not resolve host' }, 'dns'],
        [{ message: 'certificate chain validation failed' }, 'tls'],
        [{ message: 'Trust anchor for certification path not found' }, 'tls'],
        [{ message: 'HTTP 502' }, 'http'],
        [{ message: 'CANCELLED' }, 'cancelled'],
        [{ message: 'Job was cancelled' }, 'cancelled'],
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
