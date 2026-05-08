import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    hostnameMatchesAllowlist,
    hostnameMatchesAnyAllowlist,
    hostnameSuffixCandidates,
    sha256Hex,
} from './domain-suffix.ts';

describe('hostnameSuffixCandidates', () => {
    it('returns shortest suffix first', () => {
        assert.deepEqual(hostnameSuffixCandidates('a.b.c'), ['c', 'b.c', 'a.b.c']);
    });
    it('handles single-label hostnames', () => {
        assert.deepEqual(hostnameSuffixCandidates('localhost'), ['localhost']);
    });
    it('returns empty for empty input', () => {
        assert.deepEqual(hostnameSuffixCandidates(''), []);
    });
    it('handles four-label hostnames', () => {
        assert.deepEqual(
            hostnameSuffixCandidates('w.x.y.z'),
            ['z', 'y.z', 'x.y.z', 'w.x.y.z'],
        );
    });
});

describe('hostnameMatchesAllowlist', () => {
    it('matches when the full hostname hash is listed', async () => {
        const hostname = 'sample.fixture.test';
        const allow = new Set([await sha256Hex(hostname)]);
        assert.equal(await hostnameMatchesAllowlist(hostname, allow), true);
    });

    it('approves the entire subtree when a parent suffix is listed', async () => {
        const parent = 'suffix.example';
        const allow = new Set([await sha256Hex(parent)]);
        assert.equal(await hostnameMatchesAllowlist(parent, allow), true);
        assert.equal(await hostnameMatchesAllowlist('a.suffix.example', allow), true);
        assert.equal(await hostnameMatchesAllowlist('a.b.suffix.example', allow), true);
    });

    it('does not leak approval to siblings or bare TLDs', async () => {
        const allow = new Set([await sha256Hex('suffix.example')]);
        assert.equal(await hostnameMatchesAllowlist('other.example', allow), false);
        assert.equal(await hostnameMatchesAllowlist('example', allow), false);
        assert.equal(await hostnameMatchesAllowlist('unrelated.test', allow), false);
    });

    it('rejects empty hostname and empty allowlist', async () => {
        assert.equal(await hostnameMatchesAllowlist('', new Set()), false);
        assert.equal(await hostnameMatchesAllowlist('anything.test', new Set()), false);
    });
});

describe('hostnameMatchesAnyAllowlist', () => {
    it('returns false when no allowlists are provided', async () => {
        assert.equal(await hostnameMatchesAnyAllowlist('a.test'), false);
    });

    it('returns false when every allowlist is empty', async () => {
        assert.equal(
            await hostnameMatchesAnyAllowlist('a.test', new Set(), new Set()),
            false,
        );
    });

    it('matches when the hash is only in the first allowlist', async () => {
        const known    = new Set([await sha256Hex('a.test')]);
        const verified = new Set<string>();
        assert.equal(await hostnameMatchesAnyAllowlist('a.test', known, verified), true);
    });

    it('matches when the hash is only in the second allowlist', async () => {
        const known    = new Set<string>();
        const verified = new Set([await sha256Hex('a.test')]);
        assert.equal(await hostnameMatchesAnyAllowlist('a.test', known, verified), true);
    });

    it('approves subtrees via any of the supplied allowlists', async () => {
        // Parent `suffix.example` is only in the "verified" set; its child
        // must still be approved because suffix matching runs across both.
        const known    = new Set([await sha256Hex('unrelated.zone')]);
        const verified = new Set([await sha256Hex('suffix.example')]);
        assert.equal(
            await hostnameMatchesAnyAllowlist('a.b.suffix.example', known, verified),
            true,
        );
    });

    it('does not leak approval to siblings of a matched suffix', async () => {
        const known    = new Set<string>();
        const verified = new Set([await sha256Hex('suffix.example')]);
        assert.equal(
            await hostnameMatchesAnyAllowlist('other.example', known, verified),
            false,
        );
        assert.equal(
            await hostnameMatchesAnyAllowlist('example', known, verified),
            false,
        );
    });

    it('returns false when every allowlist disagrees with every suffix', async () => {
        const known    = new Set([await sha256Hex('approved.zone')]);
        const verified = new Set([await sha256Hex('also-approved.zone')]);
        assert.equal(
            await hostnameMatchesAnyAllowlist('intruder.test', known, verified),
            false,
        );
    });

    it('accepts more than two allowlists (variadic)', async () => {
        const a = new Set<string>();
        const b = new Set<string>();
        const c = new Set([await sha256Hex('deep.example')]);
        assert.equal(
            await hostnameMatchesAnyAllowlist('x.deep.example', a, b, c),
            true,
        );
    });

    it('agrees with hostnameMatchesAllowlist on the union of allowlists', async () => {
        const host = 'child.union.test';
        const a    = new Set([await sha256Hex('union.test')]);
        const b    = new Set([await sha256Hex('other.ignored')]);
        const union = new Set([...a, ...b]);

        const viaAny   = await hostnameMatchesAnyAllowlist(host, a, b);
        const viaUnion = await hostnameMatchesAllowlist(host, union);
        assert.equal(viaAny, viaUnion);
        assert.equal(viaAny, true);
    });
});

describe('sha256Hex', () => {
    it('produces a 64-char lowercase hex digest', async () => {
        const h = await sha256Hex('anything');
        assert.equal(h.length, 64);
        assert.match(h, /^[0-9a-f]{64}$/);
    });

    it('is deterministic', async () => {
        const [a, b] = await Promise.all([
            sha256Hex('same-input'),
            sha256Hex('same-input'),
        ]);
        assert.equal(a, b);
    });
});
