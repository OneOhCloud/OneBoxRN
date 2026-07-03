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

// 仅在原生平台上惰性 require expo-sqlite。在 web 上做顶层 import 会加载
// wa-sqlite 及其 worker，它们在模块初始化期间会触碰 IndexedDB / OPFS，并在
// 受限浏览器环境（无痕、Safari、无 SharedArrayBuffer 的环境）中抛出
// UnknownError。Web 改用 localStorage，因此那里从不需要 SQLite。type-only
// import 在构建期被擦除，不会牵入运行时模块。
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

// Web：在缺少跨源隔离头（COOP/COEP）时，expo-sqlite web 会回落到内存
// MemoryVFS，因此 SQLite 无法跨刷新持久化。web 上把 KV 层走 localStorage 以
// 获得真正的持久化。
const WEB_KV_PREFIX = 'oneoh_kv:';
const isWeb = Platform.OS === 'web';

function getDB(): SQLiteDatabase {
    if (isWeb) {
        throw new Error('[KV] getDB() must never be called on web');
    }
    if (!_db) {
        _db = SQLite!.openDatabaseSync('config.db');
        // 运行时防御性建表，以防在 SQLiteProvider onInit 迁移运行之前就调用了
        // getDB()。刻意不与 sqlite3.tsx 里的 v1→2 CREATE 共用：那份副本是冻结的
        // 迁移步骤（已发布的历史，绝不可改），而这份追踪的是当前存活的 schema ——
        // 共用同一个常量会让未来的 schema 变更悄悄改写迁移历史。
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
// Profile —— 多配置文件数据模型
// ─────────────────────────────────────────────────────────────────────────────

export type { Profile } from './profile-store-core';

// 纯核心（node:test 覆盖见 profile-store-core.test.ts）接到真实 KV 后端。
// 持久化的 key 格式保持不变。
const kvBackend: KvBackend = {
    get: kvGet,
    set: kvSet,
    delete: kvDelete,
};

export const ProfileStore = createProfileStore(kvBackend);

// ─── V1 单配置文件 → 多配置文件迁移 ────────────────────────────

/**
 * 从单配置文件 kv key 到 ProfileStore 格式的一次性迁移。
 */
export function migrateV1ProfileToMulti(): void {
    migrateV1ProfileToMultiCore(kvBackend, ProfileStore, deriveProfileNameFromUrl);
}

// ─────────────────────────────────────────────────────────────────────────────
// ProfileConfig —— 活动配置文件之上的兼容 shim
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

    // sing-box 核心日志等级。在把配置交给引擎的那一刻，由 rewriteConfig() 注入
    // 到 `log.level`。内置模板自带 `debug`；这里默认 `info`，以免正常运行时刷屏
    // 日志查看器。下次 VPN 重启时生效。
    getLogLevel: (): SingBoxLogLevel =>
        (kvGet(LOG_LEVEL_KEY) as SingBoxLogLevel | null) ?? 'info',
    setLogLevel: (level: SingBoxLogLevel) => kvSet(LOG_LEVEL_KEY, level),
};

// sing-box 文档记录的等级（见 sing-box 参考文档中的 `Log level`）。
// `fatal` / `panic` 是终止级 —— 这里为完整性暴露它们，但实践中用户很少选用；
// 默认仍是 `info`。
export const SING_BOX_LOG_LEVELS = [
    'trace', 'debug', 'info', 'warn', 'error', 'fatal', 'panic',
] as const;
export type SingBoxLogLevel = (typeof SING_BOX_LOG_LEVELS)[number];

// ─── 任务执行日志 ──────────────────────────────────────────────────────

export type TaskStatus = 'success' | 'failed' | 'skipped';
export type TriggerSource = 'auto' | 'manual-direct';

export interface TaskRecord {
    // ── 执行信息 ───────────────────────────────────────────────────────
    time: string;
    status: TaskStatus;
    trigger: TriggerSource;
    duration: number;
    method: string;             // 'primary' | 'fallback'
    contentChanged: boolean;
    error?: string;

    // ── 脱敏后的加速代理 URL（log-redact 的 redactUrl）──────────────────────
    // primary URL 不存储：TaskLog 已用它作为 key，且 ProfileStore 本就会持久化
    // 它。原始 URL / 原始 userinfo 头绝不进入持久存储（config-fetch-policy §
    // log redaction）。
    acceleratedUrlRedacted?: string;

    // ── 与 [EVT] flow=<id> 日志行关联 ────────────────────────────
    flowId?: string;

    // ── 流量（直接来自原生 —— JS 不再解析）────────────────────
    upload: number;
    download: number;
    total: number;
    expire: number;
}

/** KV 中可能仍存在的、脱敏机制之前持久化的记录形态。 */
type StoredTaskRecord = TaskRecord & {
    primaryUrl?: string;
    acceleratedUrl?: string;
    userinfoHeader?: string;
};

// 读时清洗：显示立即被修正；存储借 30 天保留窗口自愈，无需迁移。
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

// djb2Hash 与既有的 hashUrl 逐字节一致，因此现存的 task_log_* KV key 仍然有效。
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

// ─── 持久化的最近一次失败 ──────────────────────────────────────────────────

export interface LastFailureSummary {
    flowId: string;
    event: string;
    time: string;
    platform: string;
    phase?: string;
    errorCode?: string;
    /** 已预先脱敏的自由文本 —— 绝非原始 URL/token/头。 */
    detail?: string;
}

const LAST_FAILURE_KEY = 'last_failure_summary';

/**
 * 最近一次失败的 flow，独立于内存日志环持久化 —— 清空 Logs 界面不得抹掉支持
 * 团队需要的摘要。
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

// ─── app 启动标记 ────────────────────────────────────────────────────────

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

// ─── Bugsnag 崩溃测试标记 ────────────────────────────────────────────────

export type BugsnagCrashTestKind = 'js' | 'native-android';

const BUGSNAG_CRASH_TEST_KEY = 'bugsnag_crash_test_on_next_launch';

/**
 * 在 app 启动期间消费的一次性崩溃测试标记。
 *
 * 刻意做成持久化，使 QA 能从隐藏的 dev 页面装填崩溃、完全重启 app，并验证
 * Bugsnag 能捕获到 app 启动阶段的崩溃。
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
