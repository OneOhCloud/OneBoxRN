import { configType } from '@/definition';
import { urlFilename, urlHostname } from '@/utils';
import type { SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';

// Lazy require expo-sqlite only on native platforms. Top-level importing on
// web loads wa-sqlite + its worker, which touches IndexedDB / OPFS during
// module init and throws UnknownError in restricted browser contexts
// (incognito, Safari, envs without SharedArrayBuffer). Web uses localStorage
// instead, so we never need SQLite there. Type-only imports erase at build
// time and don't pull in the runtime module.
type ExpoSQLite = typeof import('expo-sqlite');
let SQLite: ExpoSQLite | null = null;
if (Platform.OS !== 'web') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    SQLite = require('expo-sqlite') as ExpoSQLite;
}

// ─────────────────────────────────────────────────────────────────────────────
// SQLite KV 后端
// ─────────────────────────────────────────────────────────────────────────────

let _db: SQLiteDatabase | null = null;
/** 内存缓存：同步读取直接命中，写入同时更新缓存与 SQLite */
const _cache: Record<string, string> = {};
let _cacheLoaded = false;

// Web: expo-sqlite web falls back to in-memory MemoryVFS without cross-origin
// isolation headers (COOP/COEP), so SQLite does not persist across reloads.
// Route the KV layer through localStorage on web to get real persistence.
const WEB_KV_PREFIX = 'oneoh_kv:';
const isWeb = Platform.OS === 'web';

function getDB(): SQLiteDatabase {
    if (isWeb) {
        throw new Error('[KV] getDB() must never be called on web');
    }
    if (!_db) {
        _db = SQLite!.openDatabaseSync('config.db');
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
 */
export function migrateV1ProfileToMulti(): void {
    if (kvGet(PROFILE_MIGRATION_V1_FLAG) === '1') return;

    const url = kvGet('configLink');
    if (url) {
        console.log('[KV] Migrating v1 single-profile to multi-profile format...');
        let name = kvGet('configName') ?? '';
        if (!name || name === 'default') {
            name = urlFilename(url) ?? urlHostname(url, 'Profile');
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

    // sing-box core log level. Injected into `log.level` by rewriteConfig()
    // at the moment we hand the config to the engine. The built-in template
    // ships with `debug`; we default to `info` here to avoid flooding the
    // log viewer during normal operation. Takes effect on next VPN restart.
    getLogLevel: (): SingBoxLogLevel =>
        (kvGet('sing_box_log_level') as SingBoxLogLevel | null) ?? 'info',
    setLogLevel: (level: SingBoxLogLevel) => kvSet('sing_box_log_level', level),
};

// sing-box documented levels (see `Log level` in sing-box reference).
// `fatal` / `panic` are terminal — they're exposed here for completeness
// but in practice the user rarely picks them; the default stays `info`.
export const SING_BOX_LOG_LEVELS = [
    'trace', 'debug', 'info', 'warn', 'error', 'fatal', 'panic',
] as const;
export type SingBoxLogLevel = (typeof SING_BOX_LOG_LEVELS)[number];

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

// ─── Bugsnag Crash Test Flags ────────────────────────────────────────────────

export type BugsnagCrashTestKind = 'js' | 'native-android';

const BUGSNAG_CRASH_TEST_KEY = 'bugsnag_crash_test_on_next_launch';

/**
 * One-shot crash-test flag consumed during app startup.
 *
 * This is intentionally persisted so QA can arm the crash from the hidden dev
 * screen, fully restart the app, and verify Bugsnag captures an app-start crash.
 */
export const BugsnagCrashTestFlags = {
    arm(kind: BugsnagCrashTestKind): void {
        kvSet(BUGSNAG_CRASH_TEST_KEY, kind);
    },
    consume(): BugsnagCrashTestKind | null {
        const kind = kvGet(BUGSNAG_CRASH_TEST_KEY) as BugsnagCrashTestKind | null;
        kvDelete(BUGSNAG_CRASH_TEST_KEY);
        if (kind === 'js' || kind === 'native-android') return kind;
        return null;
    },
};
