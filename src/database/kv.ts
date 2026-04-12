import { configType } from '@/definition';
import { urlHostname } from '@/utils';
import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';
import { createMMKV } from 'react-native-mmkv';

// ─────────────────────────────────────────────────────────────────────────────
// @deprecated MMKV storage — retained for migration only, do not use directly
// ─────────────────────────────────────────────────────────────────────────────

/** @deprecated 仅保留用于数据迁移，请勿在新代码中直接使用。 */
let _mmkvStorage: any;
if (Platform.OS === 'web') {
    _mmkvStorage = {
        set: (key: string, value: any) => localStorage.setItem(key, JSON.stringify(value)),
        getString: (key: string) => { const v = localStorage.getItem(key); return v ? JSON.parse(v) : undefined; },
        getNumber: (key: string) => { const v = localStorage.getItem(key); return v ? Number(JSON.parse(v)) : undefined; },
        getBoolean: (key: string) => { const v = localStorage.getItem(key); return v ? Boolean(JSON.parse(v)) : undefined; },
        getAllKeys: () => Object.keys(localStorage),
        delete: (key: string) => localStorage.removeItem(key),
        clearAll: () => localStorage.clear(),
    };
} else {
    _mmkvStorage = createMMKV({ id: 'oneoh-config-storage', encryptionKey: 'oneoh-networktools' });
}

/** @deprecated 直接访问 MMKV，仅用于迁移兼容层。新代码请使用 SBConfig / TaskLog 等 API。 */
export const MMKVStore = _mmkvStorage;

// ─────────────────────────────────────────────────────────────────────────────
// SQLite KV 后端
// ─────────────────────────────────────────────────────────────────────────────

let _db: SQLite.SQLiteDatabase | null = null;
/** 内存缓存：同步读取直接命中，写入同时更新缓存与 SQLite */
const _cache: Record<string, string> = {};
let _cacheLoaded = false;

// Web: expo-sqlite web falls back to in-memory MemoryVFS without cross-origin
// isolation headers (COOP/COEP), so SQLite does not persist across reloads.
// Route the KV layer through localStorage on web to get real persistence.
const WEB_KV_PREFIX = 'oneoh_kv:';
const isWeb = Platform.OS === 'web';

function getDB(): SQLite.SQLiteDatabase {
    if (!_db) {
        _db = SQLite.openDatabaseSync('config.db');
        // 确保 kv_store 表存在（SQLiteProvider 的 onInit 可能尚未运行）
        _db.execSync(`
            CREATE TABLE IF NOT EXISTS kv_store (
                key   TEXT PRIMARY KEY NOT NULL,
                value TEXT
            );
        `);
    }
    return _db;
}

function loadCache(): void {
    if (_cacheLoaded) return;
    if (isWeb) {
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const fullKey = localStorage.key(i);
                if (!fullKey || !fullKey.startsWith(WEB_KV_PREFIX)) continue;
                const v = localStorage.getItem(fullKey);
                if (v !== null) _cache[fullKey.slice(WEB_KV_PREFIX.length)] = v;
            }
        } catch (e) {
            console.warn('[KV] Failed to load cache from localStorage:', e);
        }
        _cacheLoaded = true;
        return;
    }
    try {
        const rows = getDB().getAllSync<{ key: string; value: string }>(
            'SELECT key, value FROM kv_store'
        );
        for (const row of rows) {
            _cache[row.key] = row.value;
        }
    } catch (e) {
        console.warn('[KV] Failed to load cache from SQLite:', e);
    }
    _cacheLoaded = true;
}

/** 从内存缓存读取（首次自动从 SQLite 加载） */
export function kvGet(key: string): string | null {
    loadCache();
    return _cache[key] ?? null;
}

/** 写入内存缓存并同步持久化到 SQLite */
export function kvSet(key: string, value: string): void {
    loadCache();
    _cache[key] = value;
    if (isWeb) {
        try {
            localStorage.setItem(WEB_KV_PREFIX + key, value);
        } catch (e) {
            console.warn('[KV] localStorage write failed for key:', key, e);
        }
        return;
    }
    try {
        getDB().runSync(
            'INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)',
            [key, value]
        );
    } catch (e) {
        console.warn('[KV] SQLite write failed for key:', key, e);
    }
}

/** 从缓存与 SQLite 中删除指定 key */
export function kvDelete(key: string): void {
    loadCache();
    delete _cache[key];
    if (isWeb) {
        try {
            localStorage.removeItem(WEB_KV_PREFIX + key);
        } catch (e) {
            console.warn('[KV] localStorage delete failed for key:', key, e);
        }
        return;
    }
    try {
        getDB().runSync('DELETE FROM kv_store WHERE key = ?', [key]);
    } catch (e) {
        console.warn('[KV] SQLite delete failed for key:', key, e);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MMKV → SQLite 数据迁移
// ─────────────────────────────────────────────────────────────────────────────

const MIGRATION_FLAG = 'mmkv_migrated_v1';

// 已知存储为 number 类型的 MMKV key
const NUMBER_KEYS = new Set(['usedTraffic', 'totalTraffic', 'expireTime']);
// 已知存储为 boolean 类型的 MMKV key
const BOOLEAN_KEYS = new Set(['firstLaunchDone']);

/**
 * 将 MMKV 中的全部数据迁移到 SQLite kv_store 表。
 * - 幂等：已迁移则立即返回。
 * - URL 去重：configLink 相同值只写入一次。
 * - 迁移成功后清除 MMKV 数据。
 * - 使用同步 SQLite API，可在 React 渲染前安全调用。
 */
export function migrateMMKVToSQLite(): void {
    // web 平台不需要迁移
    if (Platform.OS === 'web') {
        kvSet(MIGRATION_FLAG, '1');
        return;
    }

    loadCache();

    // 已迁移则跳过
    if (kvGet(MIGRATION_FLAG) === '1') return;

    console.log('[KV] Starting MMKV → SQLite migration...');

    try {
        const allKeys: string[] = _mmkvStorage.getAllKeys?.() ?? [];
        const db = getDB();
        const entries: Array<[string, string]> = [];
        const seenConfigUrls = new Set<string>();

        for (const key of allKeys) {
            try {
                let value: string | null = null;

                if (NUMBER_KEYS.has(key)) {
                    const n: number | undefined = _mmkvStorage.getNumber(key);
                    if (n !== null && n !== undefined) value = String(n);
                } else if (BOOLEAN_KEYS.has(key)) {
                    const b: boolean | undefined = _mmkvStorage.getBoolean(key);
                    if (b !== null && b !== undefined) value = b ? 'true' : 'false';
                } else {
                    // 字符串、任务日志 JSON、任意其他 key
                    const s: string | undefined = _mmkvStorage.getString(key);
                    if (s !== null && s !== undefined) value = s;
                }

                if (value === null || value === undefined) continue;

                // configLink URL 应用层唯一性去重
                if (key === 'configLink') {
                    if (seenConfigUrls.has(value)) {
                        console.log('[KV] Migration: skipping duplicate configLink:', value);
                        continue;
                    }
                    seenConfigUrls.add(value);
                }

                entries.push([key, value]);
            } catch (e) {
                console.warn('[KV] Migration: failed to read key:', key, e);
            }
        }

        // 单事务批量写入
        db.withTransactionSync(() => {
            for (const [k, v] of entries) {
                db.runSync(
                    'INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)',
                    [k, v]
                );
                _cache[k] = v;
            }
            // 写入迁移完成标记
            db.runSync(
                'INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)',
                [MIGRATION_FLAG, '1']
            );
            _cache[MIGRATION_FLAG] = '1';
        });

        // 迁移成功后删除 MMKV 数据
        _mmkvStorage.clearAll?.();

        console.log(`[KV] MMKV → SQLite migration complete. Migrated ${entries.length} entries.`);
    } catch (e) {
        console.error('[KV] Migration failed, will retry on next launch:', e);
        // 不设置迁移标记，下次启动重试
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile — multi-profile data model
// ─────────────────────────────────────────────────────────────────────────────

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

function generateProfileId(): string {
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

const PROFILE_IDS_KEY    = 'sub_ids';
const ACTIVE_PROFILE_KEY = 'active_sub_id';

function profileKey(id: string): string { return `sub_${id}`; }

export const ProfileStore = {
    getIds(): string[] {
        const raw = kvGet(PROFILE_IDS_KEY);
        if (!raw) return [];
        try { return JSON.parse(raw) as string[]; } catch { return []; }
    },

    getAll(): Profile[] {
        return this.getIds()
            .map(id => this.getById(id))
            .filter((s): s is Profile => s !== null);
    },

    getById(id: string): Profile | null {
        const raw = kvGet(profileKey(id));
        if (!raw) return null;
        try { return JSON.parse(raw) as Profile; } catch { return null; }
    },

    getActiveId(): string | null {
        return kvGet(ACTIVE_PROFILE_KEY);
    },

    setActiveId(id: string): void {
        kvSet(ACTIVE_PROFILE_KEY, id);
    },

    getActive(): Profile | null {
        const id = this.getActiveId();
        if (!id) {
            // Auto-promote first profile if no active is set
            const ids = this.getIds();
            if (ids.length > 0) {
                kvSet(ACTIVE_PROFILE_KEY, ids[0]);
                return this.getById(ids[0]);
            }
            return null;
        }
        return this.getById(id);
    },

    add(data: Omit<Profile, 'id' | 'addedAt'>): Profile {
        const id = generateProfileId();
        const profile: Profile = { ...data, id, addedAt: Date.now() };
        const ids = this.getIds();
        ids.push(id);
        kvSet(PROFILE_IDS_KEY, JSON.stringify(ids));
        kvSet(profileKey(id), JSON.stringify(profile));
        return profile;
    },

    update(id: string, patch: Partial<Omit<Profile, 'id' | 'addedAt'>>): void {
        const existing = this.getById(id);
        if (!existing) return;
        kvSet(profileKey(id), JSON.stringify({ ...existing, ...patch }));
    },

    delete(id: string): void {
        const ids = this.getIds().filter(i => i !== id);
        kvSet(PROFILE_IDS_KEY, JSON.stringify(ids));
        kvDelete(profileKey(id));
        if (this.getActiveId() === id) {
            if (ids.length > 0) kvSet(ACTIVE_PROFILE_KEY, ids[0]);
            else kvDelete(ACTIVE_PROFILE_KEY);
        }
    },

    findByUrl(url: string): Profile | null {
        return this.getAll().find(s => s.url === url) ?? null;
    },

    /** Update existing profile by URL, or add a new one. Sets it as active. */
    upsertByUrl(data: Omit<Profile, 'id' | 'addedAt'>): Profile {
        const existing = this.findByUrl(data.url);
        if (existing) {
            this.update(existing.id, data);
            this.setActiveId(existing.id);
            return { ...existing, ...data };
        }
        const profile = this.add(data);
        this.setActiveId(profile.id);
        return profile;
    },
};

// ─── V1 single-profile → multi-profile migration ────────────────────────────

const PROFILE_MIGRATION_V1_FLAG = 'sub_migration_v1';

/**
 * One-time migration from single-profile kv keys to ProfileStore format.
 * Must be called after migrateMMKVToSQLite().
 */
export function migrateV1ProfileToMulti(): void {
    if (kvGet(PROFILE_MIGRATION_V1_FLAG) === '1') return;

    const url = kvGet('configLink');
    if (url) {
        console.log('[KV] Migrating v1 single-profile to multi-profile format...');
        let name = kvGet('configName') ?? '';
        if (!name || name === 'default') {
            name = urlHostname(url, 'Profile');
        }
        const profile = ProfileStore.add({
            name,
            url,
            usedTraffic: Number(kvGet('usedTraffic') ?? '0'),
            totalTraffic: Number(kvGet('totalTraffic') ?? '1'),
            expireTime: Number(kvGet('expireTime') ?? '0'),
            configContent: kvGet('configContent') ?? '',
        });
        kvSet(ACTIVE_PROFILE_KEY, profile.id);
        kvDelete('configLink');
        kvDelete('configName');
        kvDelete('usedTraffic');
        kvDelete('totalTraffic');
        kvDelete('expireTime');
        kvDelete('configContent');
        console.log('[KV] V1 profile migrated, id:', profile.id);
    }

    kvSet(PROFILE_MIGRATION_V1_FLAG, '1');
}

// ─────────────────────────────────────────────────────────────────────────────
// SBConfig — compat shim over the active profile
// ─────────────────────────────────────────────────────────────────────────────

export const SBConfig = {
    getConfigLink: (): string | null => ProfileStore.getActive()?.url ?? null,
    setConfigLink: (url: string) => {
        const a = ProfileStore.getActive();
        if (a) ProfileStore.update(a.id, { url });
    },

    getConfigName: (): string => ProfileStore.getActive()?.name ?? 'default',
    setConfigName: (name: string) => {
        const a = ProfileStore.getActive();
        if (a) ProfileStore.update(a.id, { name });
    },

    getUsedTraffic: (): number => ProfileStore.getActive()?.usedTraffic ?? 0,
    setUsedTraffic: (n: number) => {
        const a = ProfileStore.getActive();
        if (a) ProfileStore.update(a.id, { usedTraffic: n });
    },

    getTotalTraffic: (): number => ProfileStore.getActive()?.totalTraffic ?? 1,
    setTotalTraffic: (n: number) => {
        const a = ProfileStore.getActive();
        if (a) ProfileStore.update(a.id, { totalTraffic: n });
    },

    getExpireTime: (): number => ProfileStore.getActive()?.expireTime ?? 0,
    setExpireTime: (t: number) => {
        const a = ProfileStore.getActive();
        if (a) ProfileStore.update(a.id, { expireTime: t });
    },

    getConfigContent: (): string => ProfileStore.getActive()?.configContent ?? '',
    setConfigContent: (content: string) => {
        const a = ProfileStore.getActive();
        if (a) ProfileStore.update(a.id, { configContent: content });
    },

    setMode: (mode: configType) => kvSet('mode', mode),
    getMode: (): configType    => (kvGet('mode') as configType) ?? 'tun-rules',
};

// ─── Task Execution Log ──────────────────────────────────────────────────────

export type TaskStatus = 'success' | 'failed' | 'skipped';
export type TriggerSource = 'auto' | 'manual-direct';

export interface TaskRecord {
    // ── Execution info ───────────────────────────────────────────────────────
    time: string;
    status: TaskStatus;
    trigger: TriggerSource;
    duration: number;
    method: string;             // 'primary' | 'fallback'
    contentChanged: boolean;
    error?: string;

    // ── URLs used ────────────────────────────────────────────────────────────
    primaryUrl?: string;
    acceleratedUrl?: string;

    // ── Traffic (directly from native — no JS re-parsing) ────────────────────
    upload: number;
    download: number;
    total: number;
    expire: number;

    // ── Raw header for debugging ─────────────────────────────────────────────
    userinfoHeader?: string;
}

export interface TaskLogEntry {
    totalCount: number;
    lastExecutedAt: string | null;
    lastStatus: TaskStatus | null;
    records: TaskRecord[];
}

/** Simple string → short hash (djb2) */
function hashUrl(url: string): string {
    let h = 5381;
    for (let i = 0; i < url.length; i++) {
        h = ((h << 5) + h + url.charCodeAt(i)) >>> 0;
    }
    return h.toString(36);
}

const MAX_RECORDS = 100;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function taskLogKey(url: string): string {
    return `task_log_${hashUrl(url)}`;
}

function emptyLog(): TaskLogEntry {
    return { totalCount: 0, lastExecutedAt: null, lastStatus: null, records: [] };
}

export const TaskLog = {
    get(url: string): TaskLogEntry {
        const raw = kvGet(taskLogKey(url));
        if (!raw) return emptyLog();
        try { return JSON.parse(raw) as TaskLogEntry; } catch { return emptyLog(); }
    },

    append(url: string, record: TaskRecord): void {
        const log = TaskLog.get(url);
        log.records.push(record);
        log.totalCount += 1;
        log.lastExecutedAt = record.time;
        log.lastStatus = record.status;

        const cutoff = Date.now() - MAX_AGE_MS;
        log.records = log.records
            .filter((r) => new Date(r.time).getTime() >= cutoff)
            .slice(-MAX_RECORDS);

        kvSet(taskLogKey(url), JSON.stringify(log));
    },

    clear(url: string): void {
        kvSet(taskLogKey(url), JSON.stringify(emptyLog()));
    },
};

// ─── Pending Trigger ─────────────────────────────────────────────────────────

const PENDING_TRIGGER_KEY = 'pending_task_trigger';

/** Temporary flag to pass trigger source into the worker callback */
export const PendingTrigger = {
    set(source: TriggerSource): void {
        kvSet(PENDING_TRIGGER_KEY, source);
    },
    consume(): TriggerSource {
        const val = kvGet(PENDING_TRIGGER_KEY) as TriggerSource | null;
        kvDelete(PENDING_TRIGGER_KEY);
        return val ?? 'auto';
    },
};

// ─── App Launch Flags ────────────────────────────────────────────────────────

/**
 * 首次启动标记 — 用于在 app 启动时执行一次性初始化任务：
 * - Android: 申请通知权限、电池优化豁免
 * - iOS:     触发网络权限弹窗
 */
export const AppLaunchFlags = {
    isFirstLaunch: (): boolean  => kvGet('firstLaunchDone') !== 'true',
    markFirstLaunchDone: (): void => kvSet('firstLaunchDone', 'true'),
};
