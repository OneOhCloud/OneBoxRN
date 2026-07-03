import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mergeUserTunField, type TunConfigLike } from './tun-exclusions.ts';

// 用 type 别名（而非 interface），使其获得隐式索引签名，从而仍可赋值给合并器
// 的结构类型 TunConfigLike。
type TunInbound = {
    type?: string;
    exclude_package?: string[];
    route_exclude_address?: string[];
};
type Config = TunConfigLike & { inbounds: TunInbound[] };

function cfg(tun: Partial<TunInbound> = {}): Config {
    return { inbounds: [{ type: 'tun', ...tun }, { type: 'mixed' }] };
}

test('merges exclude_package (Android) from user into template tun inbound', () => {
    const user = cfg({ exclude_package: ['com.a', 'com.b'] });
    const tpl = cfg();
    mergeUserTunField(user, tpl, 'exclude_package');
    assert.deepEqual(tpl.inbounds[0].exclude_package, ['com.a', 'com.b']);
});

test('merges route_exclude_address (iOS) on top of template defaults, deduped', () => {
    const user = cfg({ route_exclude_address: ['10.0.0.0/8', '1.2.3.4/32'] });
    const tpl = cfg({ route_exclude_address: ['10.0.0.0/8', '192.168.0.0/16'] });
    mergeUserTunField(user, tpl, 'route_exclude_address');
    // 模板条目保持顺序；用户新增的 CIDR 追加在后；10.0.0.0/8 折叠。
    assert.deepEqual(tpl.inbounds[0].route_exclude_address, [
        '10.0.0.0/8', '192.168.0.0/16', '1.2.3.4/32',
    ]);
});

test('only the requested field is merged, others untouched', () => {
    const user = cfg({ exclude_package: ['com.a'], route_exclude_address: ['1.2.3.4/32'] });
    const tpl = cfg();
    mergeUserTunField(user, tpl, 'exclude_package');
    assert.deepEqual(tpl.inbounds[0].exclude_package, ['com.a']);
    assert.equal(tpl.inbounds[0].route_exclude_address, undefined);
});

test('no-op when user config has no tun inbound', () => {
    const user: Config = { inbounds: [{ type: 'mixed' }] };
    const tpl = cfg({ exclude_package: ['com.keep'] });
    mergeUserTunField(user, tpl, 'exclude_package');
    assert.deepEqual(tpl.inbounds[0].exclude_package, ['com.keep']);
});

test('no-op when template has no tun inbound', () => {
    const user = cfg({ exclude_package: ['com.a'] });
    const tpl: Config = { inbounds: [{ type: 'mixed' }] };
    mergeUserTunField(user, tpl, 'exclude_package');
    assert.equal('exclude_package' in tpl.inbounds[0], false);
});

test('no-op when user field is absent or empty', () => {
    const tpl1 = cfg();
    mergeUserTunField(cfg(), tpl1, 'exclude_package');
    assert.equal(tpl1.inbounds[0].exclude_package, undefined);

    const tpl2 = cfg();
    mergeUserTunField(cfg({ exclude_package: [] }), tpl2, 'exclude_package');
    assert.equal(tpl2.inbounds[0].exclude_package, undefined);
});

test('ignores non-string entries in the user list', () => {
    const user = cfg({ exclude_package: ['com.a', 42 as unknown as string, 'com.b'] });
    const tpl = cfg();
    mergeUserTunField(user, tpl, 'exclude_package');
    assert.deepEqual(tpl.inbounds[0].exclude_package, ['com.a', 'com.b']);
});

test('de-dupes within the user list', () => {
    const user = cfg({ exclude_package: ['com.a', 'com.a', 'com.b'] });
    const tpl = cfg();
    mergeUserTunField(user, tpl, 'exclude_package');
    assert.deepEqual(tpl.inbounds[0].exclude_package, ['com.a', 'com.b']);
});

test('null / undefined user config → no throw, returns template', () => {
    const tpl = cfg();
    assert.equal(mergeUserTunField(null, tpl, 'exclude_package'), tpl);
    assert.equal(mergeUserTunField(undefined, tpl, 'exclude_package'), tpl);
    assert.equal(tpl.inbounds[0].exclude_package, undefined);
});

test('missing inbounds arrays → no throw', () => {
    assert.doesNotThrow(() => mergeUserTunField({}, {}, 'exclude_package'));
});
