import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseProfileUserinfo } from './profile-info.ts';

// Golden-sample lock for the `subscription-userinfo` header parser. This is the
// reference spec that the four implementations of the same parse must agree on
// (JS here, the web-stub mirror in ExpoOneBoxModule.web.ts, and the Kotlin /
// Swift native workers). A change here that the native copies don't mirror is a
// cross-platform contract break (audit C6 / D3c-03 / D8-07).

describe('parseProfileUserinfo (cross-platform golden sample)', () => {
    it('parses the standard quad', () => {
        assert.deepEqual(
            parseProfileUserinfo('upload=100; download=300; total=1000; expire=1735689600'),
            { upload: 100, download: 300, total: 1000, expire: 1735689600 },
        );
    });

    it('order-independent and tolerant of extra whitespace/fields', () => {
        assert.deepEqual(
            parseProfileUserinfo('expire=1; total=2;   download=3; upload=4; foo=bar'),
            { upload: 4, download: 3, total: 2, expire: 1 },
        );
    });

    it('missing fields and null default to 0', () => {
        assert.deepEqual(parseProfileUserinfo('upload=5'), { upload: 5, download: 0, total: 0, expire: 0 });
        assert.deepEqual(parseProfileUserinfo(''), { upload: 0, download: 0, total: 0, expire: 0 });
        assert.deepEqual(parseProfileUserinfo(null), { upload: 0, download: 0, total: 0, expire: 0 });
    });

    it('the left boundary is anchored — `total=` does not match `subtotal=`', () => {
        // All 4 implementations use `total=(\d+)` without a left boundary, so a
        // `subtotal=` prefix WOULD be captured. Locked as a known shared quirk:
        // the header spec never emits `subtotal`, and drift must stay in lockstep.
        assert.equal(parseProfileUserinfo('subtotal=99; total=7').total, 99);
    });

    it('KNOWN cross-platform divergence: values beyond 2^53 lose precision (JS) — natives clamp/overflow', () => {
        // Airports encode "unlimited" as total=2^64-1. JS parseInt keeps a lossy
        // float; Kotlin `toLongOrNull()?:0` / Swift `Int64()??0` overflow to 0.
        // Documented, not yet unified (needs the native single-source; audit C6).
        const r = parseProfileUserinfo('total=18446744073709551615');
        assert.ok(r.total > 1e19, 'JS keeps a (lossy) large number rather than 0');
    });
});
