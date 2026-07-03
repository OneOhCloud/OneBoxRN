/**
 * ProfileStore 核心 —— 纯净、无依赖。
 *
 * KV 后端（原生上是 SQLite，web 上是 localStorage）以注入方式提供，使 node:test
 * 能对着 Map 支撑的假后端演练配置文件 CRUD、活动配置文件选择，以及 v1 单配置
 * 迁移。kv.ts 用真实后端包装本核心并再导出同一套公开 API —— 持久化的 key 格式
 * （`sub_ids` / `active_sub_id` / `sub_<id>` / `sub_migration_v1` 以及 v1 遗留
 * key）是持久化契约，不可更改。
 */

export interface Profile {
    id: string;
    name: string;
    url: string;
    usedTraffic: number;
    totalTraffic: number;
    expireTime: number;
    configContent: string;
    addedAt: number;
}

export interface KvBackend {
    get(key: string): string | null;
    set(key: string, value: string): void;
    delete(key: string): void;
}

const PROFILE_IDS_KEY    = 'sub_ids';
const ACTIVE_PROFILE_KEY = 'active_sub_id';
const PROFILE_MIGRATION_V1_FLAG = 'sub_migration_v1';

function profileKey(id: string): string { return `sub_${id}`; }

function defaultGenerateProfileId(): string {
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export interface ProfileStoreApi {
    getIds(): string[];
    getAll(): Profile[];
    getById(id: string): Profile | null;
    getActiveId(): string | null;
    setActiveId(id: string): void;
    getActive(): Profile | null;
    add(data: Omit<Profile, 'id' | 'addedAt'>): Profile;
    update(id: string, patch: Partial<Omit<Profile, 'id' | 'addedAt'>>): void;
    delete(id: string): void;
    findByUrl(url: string): Profile | null;
    upsertByUrl(data: Omit<Profile, 'id' | 'addedAt'>): Profile;
}

export function createProfileStore(
    kv: KvBackend,
    deps?: { generateId?: () => string; now?: () => number },
): ProfileStoreApi {
    const generateId = deps?.generateId ?? defaultGenerateProfileId;
    const now = deps?.now ?? Date.now;

    const store: ProfileStoreApi = {
        getIds(): string[] {
            const raw = kv.get(PROFILE_IDS_KEY);
            if (!raw) return [];
            try { return JSON.parse(raw) as string[]; } catch { return []; }
        },

        getAll(): Profile[] {
            return store.getIds()
                .map(id => store.getById(id))
                .filter((s): s is Profile => s !== null);
        },

        getById(id: string): Profile | null {
            const raw = kv.get(profileKey(id));
            if (!raw) return null;
            try { return JSON.parse(raw) as Profile; } catch { return null; }
        },

        getActiveId(): string | null {
            return kv.get(ACTIVE_PROFILE_KEY);
        },

        setActiveId(id: string): void {
            kv.set(ACTIVE_PROFILE_KEY, id);
        },

        getActive(): Profile | null {
            const id = store.getActiveId();
            if (!id) {
                // 未设置活动项时，自动把第一个配置文件提升为活动项
                const ids = store.getIds();
                if (ids.length > 0) {
                    kv.set(ACTIVE_PROFILE_KEY, ids[0]);
                    return store.getById(ids[0]);
                }
                return null;
            }
            return store.getById(id);
        },

        add(data: Omit<Profile, 'id' | 'addedAt'>): Profile {
            const id = generateId();
            const profile: Profile = { ...data, id, addedAt: now() };
            const ids = store.getIds();
            ids.push(id);
            kv.set(PROFILE_IDS_KEY, JSON.stringify(ids));
            kv.set(profileKey(id), JSON.stringify(profile));
            return profile;
        },

        update(id: string, patch: Partial<Omit<Profile, 'id' | 'addedAt'>>): void {
            const existing = store.getById(id);
            if (!existing) return;
            kv.set(profileKey(id), JSON.stringify({ ...existing, ...patch }));
        },

        delete(id: string): void {
            const ids = store.getIds().filter(i => i !== id);
            kv.set(PROFILE_IDS_KEY, JSON.stringify(ids));
            kv.delete(profileKey(id));
            if (store.getActiveId() === id) {
                if (ids.length > 0) kv.set(ACTIVE_PROFILE_KEY, ids[0]);
                else kv.delete(ACTIVE_PROFILE_KEY);
            }
        },

        findByUrl(url: string): Profile | null {
            return store.getAll().find(s => s.url === url) ?? null;
        },

        /** 按 URL 更新已有配置文件，否则新增一个。并设为活动项。 */
        upsertByUrl(data: Omit<Profile, 'id' | 'addedAt'>): Profile {
            const existing = store.findByUrl(data.url);
            if (existing) {
                store.update(existing.id, data);
                store.setActiveId(existing.id);
                return { ...existing, ...data };
            }
            const profile = store.add(data);
            store.setActiveId(profile.id);
            return profile;
        },
    };

    return store;
}

/**
 * 从单配置文件 kv key 到 ProfileStore 格式的一次性迁移。
 * `deriveNameFromUrl` 以注入方式提供，因为 URL 辅助函数所在模块带有运行时的
 * expo import。
 */
export function migrateV1ProfileToMultiCore(
    kv: KvBackend,
    store: ProfileStoreApi,
    deriveNameFromUrl: (url: string) => string,
): void {
    if (kv.get(PROFILE_MIGRATION_V1_FLAG) === '1') return;

    const url = kv.get('configLink');
    if (url) {
        let name = kv.get('configName') ?? '';
        if (!name || name === 'default') {
            name = deriveNameFromUrl(url);
        }
        const profile = store.add({
            name,
            url,
            usedTraffic: Number(kv.get('usedTraffic') ?? '0'),
            totalTraffic: Number(kv.get('totalTraffic') ?? '1'),
            expireTime: Number(kv.get('expireTime') ?? '0'),
            configContent: kv.get('configContent') ?? '',
        });
        store.setActiveId(profile.id);
        kv.delete('configLink');
        kv.delete('configName');
        kv.delete('usedTraffic');
        kv.delete('totalTraffic');
        kv.delete('expireTime');
        kv.delete('configContent');
    }

    kv.set(PROFILE_MIGRATION_V1_FLAG, '1');
}
