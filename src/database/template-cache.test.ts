import { test } from 'node:test';
import assert from 'node:assert/strict';
import { templateMemoryCache } from './template-cache.ts';

// 「切换配置文件导致节点累积」bug 的回归防线：
// `updateVPNServerConfigFromDB` 会修改 `getConfigTemplate` 返回的配置对象。若
// `templateMemoryCache` 交出共享的对象引用，把配置文件 A 的节点 push 进模板的
// outbounds 数组后，等到构建配置文件 B 时它们仍留在里面 —— 节点 selector 便会
// 显示 A ∪ B。

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

    // 模拟 `updateVPNServerConfigFromDB` push 配置文件 A 的 20 个节点。
    const buildForProfileA = templateMemoryCache.get('tun-rules');
    for (let i = 0; i < 20; i++) {
        buildForProfileA.outbounds[1].outbounds.push(`A-${i}`);
        buildForProfileA.outbounds[2].outbounds.push(`A-${i}`);
        buildForProfileA.outbounds.push({ tag: `A-${i}`, type: 'shadowsocks' });
    }

    // 此时切入配置文件 B；缓存必须交回一份干净的模板。
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
