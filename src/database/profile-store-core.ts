/**
 * ProfileStore core — pure, dependency-free.
 *
 * The KV backend (SQLite on native, localStorage on web) is injected so
 * node:test can exercise profile CRUD, active-profile selection and the
 * v1 single-profile migration against a Map-backed fake. kv.ts wraps
 * this with its real backend and re-exports the same public API —
 * persisted key formats (`sub_ids` / `active_sub_id` / `sub_<id>` /
 * `sub_migration_v1` and the legacy v1 keys) are unchanged.
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
                // Auto-promote first profile if no active is set
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

        /** Update existing profile by URL, or add a new one. Sets it as active. */
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
 * One-time migration from single-profile kv keys to ProfileStore format.
 * `deriveNameFromUrl` is injected because the URL helpers live in a module
 * with runtime expo imports.
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
