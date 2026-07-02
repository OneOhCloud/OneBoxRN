import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    createProfileStore,
    migrateV1ProfileToMultiCore,
    type KvBackend,
    type Profile,
} from './profile-store-core.ts';

function makeKv(): KvBackend & { dump(): Record<string, string> } {
    const map = new Map<string, string>();
    return {
        get: (k) => map.get(k) ?? null,
        set: (k, v) => {
            map.set(k, v);
        },
        delete: (k) => {
            map.delete(k);
        },
        dump: () => Object.fromEntries(map),
    };
}

function makeStore(kv: KvBackend) {
    let seq = 0;
    return createProfileStore(kv, {
        generateId: () => `id-${++seq}`,
        now: () => 1_700_000_000_000,
    });
}

const sample = (url: string, name = 'p'): Omit<Profile, 'id' | 'addedAt'> => ({
    name,
    url,
    usedTraffic: 10,
    totalTraffic: 100,
    expireTime: 0,
    configContent: '{}',
});

describe('ProfileStore core', () => {
    it('add → getIds/getById/getAll round-trip with addedAt set', () => {
        const kv = makeKv();
        const store = makeStore(kv);
        const p = store.add(sample('https://sample.fixture.test/a'));
        assert.equal(p.id, 'id-1');
        assert.equal(p.addedAt, 1_700_000_000_000);
        assert.deepEqual(store.getIds(), ['id-1']);
        assert.deepEqual(store.getById('id-1'), p);
        assert.deepEqual(store.getAll(), [p]);
    });

    it('getActive auto-promotes the first profile and persists it', () => {
        const kv = makeKv();
        const store = makeStore(kv);
        store.add(sample('https://sample.fixture.test/a'));
        assert.equal(store.getActiveId(), null);
        assert.equal(store.getActive()?.id, 'id-1');
        assert.equal(store.getActiveId(), 'id-1');
    });

    it('getActive returns null on an empty store', () => {
        const store = makeStore(makeKv());
        assert.equal(store.getActive(), null);
    });

    it('setActiveId/getActiveId round-trip', () => {
        const store = makeStore(makeKv());
        store.add(sample('https://sample.fixture.test/a'));
        store.add(sample('https://sample.fixture.test/b'));
        store.setActiveId('id-2');
        assert.equal(store.getActiveId(), 'id-2');
    });

    it('update patches fields, preserves id/addedAt; missing id is a no-op', () => {
        const store = makeStore(makeKv());
        const p = store.add(sample('https://sample.fixture.test/a'));
        store.update(p.id, { name: 'renamed', usedTraffic: 42 });
        const after = store.getById(p.id);
        assert.equal(after?.name, 'renamed');
        assert.equal(after?.usedTraffic, 42);
        assert.equal(after?.id, p.id);
        assert.equal(after?.addedAt, p.addedAt);
        store.update('missing', { name: 'x' });
        assert.equal(store.getById('missing'), null);
    });

    it('delete of a non-active profile leaves the active untouched', () => {
        const store = makeStore(makeKv());
        store.add(sample('https://sample.fixture.test/a'));
        store.add(sample('https://sample.fixture.test/b'));
        store.setActiveId('id-1');
        store.delete('id-2');
        assert.deepEqual(store.getIds(), ['id-1']);
        assert.equal(store.getActiveId(), 'id-1');
    });

    it('delete of the active profile promotes the first survivor (regression)', () => {
        const store = makeStore(makeKv());
        store.add(sample('https://sample.fixture.test/a'));
        store.add(sample('https://sample.fixture.test/b'));
        store.setActiveId('id-1');
        store.delete('id-1');
        assert.equal(store.getActiveId(), 'id-2');
        assert.equal(store.getById('id-1'), null);
    });

    it('delete of the last profile clears the active id', () => {
        const store = makeStore(makeKv());
        store.add(sample('https://sample.fixture.test/a'));
        store.setActiveId('id-1');
        store.delete('id-1');
        assert.equal(store.getActiveId(), null);
        assert.equal(store.getActive(), null);
    });

    it('findByUrl hit and miss', () => {
        const store = makeStore(makeKv());
        store.add(sample('https://sample.fixture.test/a'));
        assert.equal(store.findByUrl('https://sample.fixture.test/a')?.id, 'id-1');
        assert.equal(store.findByUrl('https://sample.fixture.test/nope'), null);
    });

    it('upsertByUrl updates an existing profile by URL and re-activates it', () => {
        const store = makeStore(makeKv());
        store.add(sample('https://sample.fixture.test/a', 'old'));
        store.add(sample('https://sample.fixture.test/b'));
        store.setActiveId('id-2');
        const updated = store.upsertByUrl(sample('https://sample.fixture.test/a', 'new'));
        assert.equal(updated.id, 'id-1');
        assert.equal(store.getById('id-1')?.name, 'new');
        assert.equal(store.getActiveId(), 'id-1');
        assert.equal(store.getIds().length, 2);
    });

    it('upsertByUrl adds and activates when the URL is new', () => {
        const store = makeStore(makeKv());
        const p = store.upsertByUrl(sample('https://sample.fixture.test/new'));
        assert.equal(p.id, 'id-1');
        assert.equal(store.getActiveId(), 'id-1');
    });

    it('corrupted JSON degrades to empty list / null instead of throwing', () => {
        const kv = makeKv();
        const store = makeStore(kv);
        kv.set('sub_ids', 'not json');
        kv.set('sub_x', '{broken');
        assert.deepEqual(store.getIds(), []);
        assert.equal(store.getById('x'), null);
    });
});

describe('migrateV1ProfileToMultiCore', () => {
    const derive = () => 'derived-name';

    function seedV1(kv: KvBackend): void {
        kv.set('configLink', 'https://sample.fixture.test/v1');
        kv.set('configName', 'my-profile');
        kv.set('usedTraffic', '5');
        kv.set('totalTraffic', '50');
        kv.set('expireTime', '123');
        kv.set('configContent', '{"v1":true}');
    }

    it('migrates all six legacy keys into one active profile and sets the flag', () => {
        const kv = makeKv();
        const store = makeStore(kv);
        seedV1(kv);
        migrateV1ProfileToMultiCore(kv, store, derive);

        const all = store.getAll();
        assert.equal(all.length, 1);
        assert.deepEqual(
            [all[0].name, all[0].url, all[0].usedTraffic, all[0].totalTraffic, all[0].expireTime, all[0].configContent],
            ['my-profile', 'https://sample.fixture.test/v1', 5, 50, 123, '{"v1":true}'],
        );
        assert.equal(store.getActiveId(), all[0].id);
        assert.equal(kv.get('sub_migration_v1'), '1');
        for (const legacy of ['configLink', 'configName', 'usedTraffic', 'totalTraffic', 'expireTime', 'configContent']) {
            assert.equal(kv.get(legacy), null, `legacy key ${legacy} should be deleted`);
        }
    });

    it("empty or 'default' configName falls back to deriveNameFromUrl", () => {
        for (const legacyName of ['', 'default']) {
            const kv = makeKv();
            const store = makeStore(kv);
            seedV1(kv);
            kv.set('configName', legacyName);
            migrateV1ProfileToMultiCore(kv, store, derive);
            assert.equal(store.getAll()[0].name, 'derived-name');
        }
    });

    it('is idempotent — the flag short-circuits a second run', () => {
        const kv = makeKv();
        const store = makeStore(kv);
        seedV1(kv);
        migrateV1ProfileToMultiCore(kv, store, derive);
        kv.set('configLink', 'https://sample.fixture.test/again');
        migrateV1ProfileToMultiCore(kv, store, derive);
        assert.equal(store.getAll().length, 1);
    });

    it('without configLink only the flag is written, no profile created', () => {
        const kv = makeKv();
        const store = makeStore(kv);
        migrateV1ProfileToMultiCore(kv, store, derive);
        assert.equal(store.getAll().length, 0);
        assert.equal(kv.get('sub_migration_v1'), '1');
    });

    it('post-migration: getActive returns the migrated profile and upsertByUrl updates it in place', () => {
        const kv = makeKv();
        const store = makeStore(kv);
        seedV1(kv);
        migrateV1ProfileToMultiCore(kv, store, derive);
        assert.equal(store.getActive()?.url, 'https://sample.fixture.test/v1');
        store.upsertByUrl(sample('https://sample.fixture.test/v1', 'refreshed'));
        assert.equal(store.getAll().length, 1);
        assert.equal(store.getActive()?.name, 'refreshed');
    });
});
