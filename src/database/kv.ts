import { configType } from '@/definition';

// 使用 expo 判断是否在 web 环境中，如果是 web 环境则使用 localStorage，否则使用 MMKV 存储
import { Platform } from 'react-native';


import { createMMKV } from 'react-native-mmkv';

let storage: any;
if (Platform.OS === 'web') {
    storage = {
        set: (key: string, value: any) => {
            localStorage.setItem(key, JSON.stringify(value));
        },
        getString: (key: string) => {
            const value = localStorage.getItem(key);
            return value ? JSON.parse(value) : null;
        },
        getNumber: (key: string) => {
            const value = localStorage.getItem(key);
            return value ? Number(JSON.parse(value)) : null;
        },
        getBoolean: (key: string) => {
            const value = localStorage.getItem(key);
            return value ? Boolean(JSON.parse(value)) : null;
        }
    }

} else {
    storage = createMMKV(
        {
            id: 'oneoh-config-storage',
            encryptionKey: 'oneoh-networktools',
        }
    )
}

export const MMKVStore = storage;

export const SBConfig = {
    setConfigLink: (link: string) => {
        MMKVStore.set('configLink', link);
    },
    getConfigLink: (): string | null => {
        return MMKVStore.getString('configLink') || null;
    },
    setConfigName: (name: string) => {
        MMKVStore.set('configName', name);
    },
    getConfigName: () => {
        return MMKVStore.getString('configName') || 'default';
    },
    setUsedTraffic: (traffic: number) => {
        MMKVStore.set('usedTraffic', traffic);
    },
    getUsedTraffic: () => {
        return MMKVStore.getNumber('usedTraffic') || 0;
    },
    setTotalTraffic: (traffic: number) => {
        MMKVStore.set('totalTraffic', traffic);
    },
    getTotalTraffic: () => {
        return MMKVStore.getNumber('totalTraffic') || 1;
    },
    setExpireTime: (time: number) => {
        MMKVStore.set('expireTime', time);
    },
    getExpireTime: () => {
        return MMKVStore.getNumber('expireTime') || 0;
    },
    setConfigContent: (content: string) => {
        MMKVStore.set('configContent', content);
    },
    getConfigContent: () => {
        return MMKVStore.getString('configContent') || '';
    },
    setMode: (mode: configType) => {
        MMKVStore.set('mode', mode);
    },
    getMode: (): configType => {
        return MMKVStore.getString('mode') as configType || 'tun-rules';
    }
}

// ─── Task Execution Log ──────────────────────────────────────────────────────

export type TaskStatus = 'success' | 'failed' | 'skipped';
export type TriggerSource = 'auto' | 'manual-direct' | 'manual-worker';

export interface TaskRecord {
    /** ISO timestamp */
    time: string;
    status: TaskStatus;
    /** How this execution was triggered */
    trigger: TriggerSource;
    /** Duration in ms */
    duration: number;
    /** Optional detail, e.g. error message */
    detail?: string;
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

function storageKey(url: string): string {
    return `task_log_${hashUrl(url)}`;
}

function emptyLog(): TaskLogEntry {
    return { totalCount: 0, lastExecutedAt: null, lastStatus: null, records: [] };
}

export const TaskLog = {
    /** Read the log for a given config URL */
    get(url: string): TaskLogEntry {
        const raw = MMKVStore.getString(storageKey(url));
        if (!raw) return emptyLog();
        try {
            return JSON.parse(raw) as TaskLogEntry;
        } catch {
            return emptyLog();
        }
    },

    /** Append a record; enforces max 100 records & 30-day retention */
    append(url: string, record: TaskRecord): void {
        const log = TaskLog.get(url);
        log.records.push(record);
        log.totalCount += 1;
        log.lastExecutedAt = record.time;
        log.lastStatus = record.status;

        // Prune: remove records older than 30 days, then cap at 100
        const cutoff = Date.now() - MAX_AGE_MS;
        log.records = log.records
            .filter((r) => new Date(r.time).getTime() >= cutoff)
            .slice(-MAX_RECORDS);

        MMKVStore.set(storageKey(url), JSON.stringify(log));
    },

    /** Clear all records for a config URL */
    clear(url: string): void {
        MMKVStore.set(storageKey(url), JSON.stringify(emptyLog()));
    },
};

const PENDING_TRIGGER_KEY = 'pending_task_trigger';

/** Temporary flag to pass trigger source into the worker callback */
export const PendingTrigger = {
    set(source: TriggerSource): void {
        MMKVStore.set(PENDING_TRIGGER_KEY, source);
    },
    consume(): TriggerSource {
        const val = MMKVStore.getString(PENDING_TRIGGER_KEY) as TriggerSource | undefined;
        MMKVStore.delete(PENDING_TRIGGER_KEY);
        return val ?? 'auto';
    },
};

/**
 * 首次启动标记 — 用于在 app 启动时执行一次性初始化任务：
 * - Android: 申请通知权限、复制 cache.db
 * - iOS:     触发网络权限弹窗、复制 cache.db
 */
export const AppLaunchFlags = {
    isFirstLaunch: (): boolean => {
        return !MMKVStore.getBoolean('firstLaunchDone');
    },
    markFirstLaunchDone: () => {
        MMKVStore.set('firstLaunchDone', true);
    }
}
