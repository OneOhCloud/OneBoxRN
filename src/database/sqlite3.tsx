import React from 'react';
import { Platform } from 'react-native';

const DATABASE_VERSION = 2;

// Native-only type alias for the DB handle. On web this is never touched.
type SQLiteDatabase = any;

// 数据库初始化/迁移函数 — 供 SQLiteProvider onInit 调用
export async function migrateDbIfNeeded(db: SQLiteDatabase) {
    const result = await db.getFirstAsync('PRAGMA user_version') as { user_version: number } | null;
    let currentDbVersion = result?.user_version ?? 0;

    if (currentDbVersion >= DATABASE_VERSION) {
        return;
    }

    if (currentDbVersion === 0) {
        await db.execAsync(`
            PRAGMA journal_mode = WAL;

            CREATE TABLE IF NOT EXISTS subscriptions (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                identifier        TEXT NOT NULL UNIQUE,
                name              TEXT,
                used_traffic      INTEGER DEFAULT 0,
                total_traffic     INTEGER DEFAULT 1,
                subscription_url  TEXT,
                official_website  TEXT,
                expire_time       INTEGER DEFAULT (strftime('%s', 'now', '+30 days')),
                last_update_time  INTEGER DEFAULT (strftime('%s', 'now'))
            );

            CREATE TABLE IF NOT EXISTS subscription_configs (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                identifier     TEXT NOT NULL,
                config_content TEXT,
                FOREIGN KEY (identifier) REFERENCES subscriptions(identifier) ON DELETE CASCADE
            );

            PRAGMA foreign_keys = ON;
        `);
        currentDbVersion = 1;
    }

    if (currentDbVersion === 1) {
        // v2: 通用 KV 存储表，替代 MMKV
        await db.execAsync(`
            CREATE TABLE IF NOT EXISTS kv_store (
                key   TEXT PRIMARY KEY NOT NULL,
                value TEXT
            );
        `);
        currentDbVersion = 2;
    }

    await db.execAsync(`PRAGMA user_version = ${DATABASE_VERSION}`);
}

// SQLiteProvider 包装组件 — 在 _layout.tsx 中使用
//
// Web 上跳过 expo-sqlite 完全 — wa-sqlite 在 incognito / 权限受限的浏览器
// 里会抛 UnknownError / InvalidStateError。即使 <SQLiteProvider> 不渲染，
// 顶层 `import` 也会把整个 web 后端（含 worker）拉进 bundle 并触发初始化，
// 所以必须 lazy-require 而不是 import。
export function DatabaseProvider({ children }: { children: React.ReactNode }) {
    if (Platform.OS === 'web') {
        return <>{children}</>;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { SQLiteProvider } = require('expo-sqlite') as typeof import('expo-sqlite');
    return (
        <SQLiteProvider databaseName="config.db" onInit={migrateDbIfNeeded}>
            {children}
        </SQLiteProvider>
    );
}
