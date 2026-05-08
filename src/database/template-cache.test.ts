import { test } from 'node:test';
import assert from 'node:assert/strict';
import { templateMemoryCache } from './template-cache.ts';

// Regression guard for the "profile switch accumulates nodes" bug:
// `updateVPNServerConfigFromDB` mutates the config object returned by
// `getConfigTemplate`. Before this fix, `templateMemoryCache` handed out
// a shared object reference, so pushing Profile A's nodes into the template's
// outbounds array left them there when Profile B's config was later built —
// the node selector then showed A ∪ B.

test('get returns a different reference than the object set', () => {
    templateMemoryCache.clear();
    const original = { outbounds: [{ tag: 'a', type: 'selector' }] };
    templateMemoryCache.set('tun-rules', original);

    const fetched = templateMemoryCache.get('tun-rules');

    assert.notEqual(fetched, original, 'must not be the same reference as the set value');
    assert.deepEqual(fetched, original, 'must be structurally equal');
});

test('two consecutive gets return independent object graphs', () => {
    templateMemoryCache.clear();
    templateMemoryCache.set('tun-rules', {
        outbounds: [{ tag: 'selector', outbounds: ['seed'] }],
    });

    const first = templateMemoryCache.get('tun-rules');
    const second = templateMemoryCache.get('tun-rules');

    assert.notEqual(first, second, 'outer objects must be distinct');
    assert.notEqual(
        first.outbounds,
        second.outbounds,
        'nested arrays must be distinct (the bug was nested-array sharing)'
    );
    assert.notEqual(
        first.outbounds[0].outbounds,
        second.outbounds[0].outbounds,
        'doubly-nested arrays must be distinct'
    );
});

test('mutating a fetched copy does not leak into subsequent fetches', () => {
    templateMemoryCache.clear();
    templateMemoryCache.set('tun-rules', {
        outbounds: [
            { tag: 'direct', type: 'direct' },
            { tag: 'selector', type: 'selector', outbounds: [] },
            { tag: 'urltest', type: 'urltest', outbounds: [] },
        ],
    });

    // Simulate `updateVPNServerConfigFromDB` pushing Profile A's 20 nodes.
    const buildForProfileA = templateMemoryCache.get('tun-rules');
    for (let i = 0; i < 20; i++) {
        buildForProfileA.outbounds[1].outbounds.push(`A-${i}`);
        buildForProfileA.outbounds[2].outbounds.push(`A-${i}`);
        buildForProfileA.outbounds.push({ tag: `A-${i}`, type: 'shadowsocks' });
    }

    // Now Profile B switches in; the cache must hand back a clean template.
    const buildForProfileB = templateMemoryCache.get('tun-rules');

    assert.equal(
        buildForProfileB.outbounds.length,
        3,
        'fresh fetch must not contain Profile A\'s server nodes'
    );
    assert.equal(buildForProfileB.outbounds[1].outbounds.length, 0);
    assert.equal(buildForProfileB.outbounds[2].outbounds.length, 0);
});

test('get returns undefined for unseen keys', () => {
    templateMemoryCache.clear();
    assert.equal(templateMemoryCache.get('tun-rules'), undefined);
    assert.equal(templateMemoryCache.get('tun-global'), undefined);
});

test('set overwrites a previous entry for the same mode', () => {
    templateMemoryCache.clear();
    templateMemoryCache.set('tun-rules', { version: 1 });
    templateMemoryCache.set('tun-rules', { version: 2 });

    assert.deepEqual(templateMemoryCache.get('tun-rules'), { version: 2 });
});
