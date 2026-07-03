import type { SQLiteDatabase } from 'expo-sqlite';
import React from 'react';
import { Platform } from 'react-native';
import ExpoOneBox from '../modules/expo-onebox';

const DATABASE_VERSION = 3;
let initialized = false;

// LEGACY (v0→1)：`subscriptions` / `subscription_configs` 是为一套从未附带 UI
// 写入方的配置文件模型创建的。运行时的配置文件 CRUD 只存在于 ProfileStore
// （kv.ts，kv_store 行）。下方 v0→1 的 CREATE 是迁移冻结的 —— 已发布的步骤绝不
// 重写（现存设备停留在 user_version 1/2）。由于这些数据在所有安装上都是孤儿且
// 为空，v2→3 步骤会 DROP 这两张表。它们的表名仍是一处已记录的 terminology 豁免
// （docs/claude/terminology-exceptions.md），因为被冻结的 v0→1 文本保留了它们；
// 请勿添加读取方或写入方。

function migrateDbIfNeededSync(db: SQLiteDatabase) {
    const result = db.getFirstSync<{ user_version: number }>('PRAGMA user_version');
    let currentDbVersion = result?.user_version ?? 0;

    if (currentDbVersion >= DATABASE_VERSION) {
        return;
    }

    if (currentDbVersion === 0) {
        db.execSync(`
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
        db.execSync(`
            CREATE TABLE IF NOT EXISTS kv_store (
                key   TEXT PRIMARY KEY NOT NULL,
                value TEXT
            );
        `);
        currentDbVersion = 2;
    }

    if (currentDbVersion === 2) {
        // DROP 掉孤儿 LEGACY 表 —— 每个安装上都为空，无读取方或写入方。所有配置
        // 文件数据都在 kv_store（不受影响）。
        db.execSync(`
            DROP TABLE IF EXISTS subscription_configs;
            DROP TABLE IF EXISTS subscriptions;
        `);
        currentDbVersion = 3;
    }

    db.execSync(`PRAGMA user_version = ${DATABASE_VERSION}`);
}

function initializeDatabaseSync() {
    if (initialized || Platform.OS === 'web') {
        return;
    }
    initialized = true;

    if (Platform.OS === 'android') {
        ExpoOneBox.repairSQLiteDirectory();
    }

    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const SQLite = require('expo-sqlite') as typeof import('expo-sqlite');
        const db = SQLite.openDatabaseSync('config.db', { useNewConnection: true });
        try {
            migrateDbIfNeededSync(db);
        } finally {
            db.closeSync();
        }
    } catch (e) {
        console.warn('[DatabaseProvider] SQLite initialization failed:', e);
    }
}

// Web：为什么惰性 require expo-sqlite 而非直接 import，见 kv.ts。
export function DatabaseProvider({ children }: { children: React.ReactNode }) {
    initializeDatabaseSync();
    return <>{children}</>;
}
