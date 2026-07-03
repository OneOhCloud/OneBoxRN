import { ConfigType } from '@/definition';
import { deriveProfileNameFromUrl } from '@/utils';
import { djb2Hash, redactUrl } from '@/utils/log-redact';
import type { SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';
import {
    createProfileStore,
    migrateV1ProfileToMultiCore,
    type KvBackend,
} from './profile-store-core';

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
        // Runtime-defensive create in case getDB() is called before the
        // SQLiteProvider onInit migration has run. Intentionally NOT shared with
        // the v1→2 CREATE in sqlite3.tsx: that copy is a frozen migration step
        // (shipped history that must never change), whereas this one tracks the
        // live schema — a shared const would let a future schema change silently
        // rewrite migration history (D9-10).
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

export type { Profile } from './profile-store-core';

// Pure core (node:test covered in profile-store-core.test.ts) wired to
// the real KV backend. Persisted key formats are unchanged.
const kvBackend: KvBackend = {
    get: kvGet,
    set: kvSet,
    delete: kvDelete,
};

export const ProfileStore = createProfileStore(kvBackend);

// ─── V1 single-profile → multi-profile migration ────────────────────────────

/**
 * One-time migration from single-profile kv keys to ProfileStore format.
 */
export function migrateV1ProfileToMulti(): void {
    migrateV1ProfileToMultiCore(kvBackend, ProfileStore, deriveProfileNameFromUrl);
}

// ─────────────────────────────────────────────────────────────────────────────
// ProfileConfig — compat shim over the active profile
// ─────────────────────────────────────────────────────────────────────────────

const MODE_KEY = 'mode';
const LOG_LEVEL_KEY = 'sing_box_log_level';

export const ProfileConfig = {
    getConfigLink: (): string | null => ProfileStore.getActive()?.url ?? null,

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

    setMode: (mode: ConfigType) => kvSet(MODE_KEY, mode),
    getMode: (): ConfigType    => (kvGet(MODE_KEY) as ConfigType) ?? 'tun-rules',

    // sing-box core log level. Injected into `log.level` by rewriteConfig()
    // at the moment we hand the config to the engine. The built-in template
    // ships with `debug`; we default to `info` here to avoid flooding the
    // log viewer during normal operation. Takes effect on next VPN restart.
    getLogLevel: (): SingBoxLogLevel =>
        (kvGet(LOG_LEVEL_KEY) as SingBoxLogLevel | null) ?? 'info',
    setLogLevel: (level: SingBoxLogLevel) => kvSet(LOG_LEVEL_KEY, level),
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

    // ── Redacted accelerator URL (log-redact redactUrl) ──────────────────────
    // The primary URL is not stored: TaskLog is already keyed by it and
    // ProfileStore persists it by design. Raw URLs / raw userinfo headers
    // never enter durable storage (config-fetch-policy § log redaction).
    acceleratedUrlRedacted?: string;

    // ── Correlates with [EVT] flow=<id> log lines ────────────────────────────
    flowId?: string;

    // ── Traffic (directly from native — no JS re-parsing) ────────────────────
    upload: number;
    download: number;
    total: number;
    expire: number;
}

/** Shape that may still exist in KV from records persisted pre-redaction. */
type StoredTaskRecord = TaskRecord & {
    primaryUrl?: string;
    acceleratedUrl?: string;
    userinfoHeader?: string;
};

// Scrub-on-read: display is fixed immediately; storage self-heals via the
// 30-day retention window without a migration.
function sanitizeRecord(raw: StoredTaskRecord): TaskRecord {
    const record = { ...raw };
    if (record.acceleratedUrl && !record.acceleratedUrlRedacted) {
        record.acceleratedUrlRedacted = redactUrl(record.acceleratedUrl);
    }
    delete record.primaryUrl;
    delete record.acceleratedUrl;
    delete record.userinfoHeader;
    return record;
}

export interface TaskLogEntry {
    totalCount: number;
    lastExecutedAt: string | null;
    lastStatus: TaskStatus | null;
    records: TaskRecord[];
}

const MAX_RECORDS = 100;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// djb2Hash matches the historical private hashUrl byte-for-byte (guarded
// by log-redact.test.ts), so existing task_log_* KV keys stay valid.
function taskLogKey(url: string): string {
    return `task_log_${djb2Hash(url)}`;
}

function emptyLog(): TaskLogEntry {
    return { totalCount: 0, lastExecutedAt: null, lastStatus: null, records: [] };
}

export const TaskLog = {
    get(url: string): TaskLogEntry {
        const raw = kvGet(taskLogKey(url));
        if (!raw) return emptyLog();
        try {
            const parsed = JSON.parse(raw) as TaskLogEntry;
            return { ...parsed, records: parsed.records.map(sanitizeRecord) };
        } catch {
            return emptyLog();
        }
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

// ─── Durable latest failure ──────────────────────────────────────────────────

export interface LastFailureSummary {
    flowId: string;
    event: string;
    time: string;
    platform: string;
    phase?: string;
    errorCode?: string;
    /** Pre-redacted free text — never raw URLs/tokens/headers. */
    detail?: string;
}

const LAST_FAILURE_KEY = 'last_failure_summary';

/**
 * Latest failed flow, persisted independently of the in-memory log ring —
 * clearing the Logs screen must not erase the summary support needs.
 */
export const LastFailure = {
    get(): LastFailureSummary | null {
        const raw = kvGet(LAST_FAILURE_KEY);
        if (!raw) return null;
        try { return JSON.parse(raw) as LastFailureSummary; } catch { return null; }
    },
    set(summary: LastFailureSummary): void {
        kvSet(LAST_FAILURE_KEY, JSON.stringify(summary));
    },
    clear(): void {
        kvDelete(LAST_FAILURE_KEY);
    },
};

// ─── App Launch Flags ────────────────────────────────────────────────────────

/**
 * 首次启动标记 — 用于在 app 启动时执行一次性初始化任务：
 * - Android: 申请通知权限、电池优化豁免
 * - iOS:     触发网络权限弹窗
 */
const FIRST_LAUNCH_DONE_KEY = 'firstLaunchDone';

export const AppLaunchFlags = {
    isFirstLaunch: (): boolean  => kvGet(FIRST_LAUNCH_DONE_KEY) !== 'true',
    markFirstLaunchDone: (): void => kvSet(FIRST_LAUNCH_DONE_KEY, 'true'),
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
