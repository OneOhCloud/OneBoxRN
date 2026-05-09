import type { SQLiteDatabase } from 'expo-sqlite';
import React from 'react';
import { Platform } from 'react-native';
import ExpoOneBox from '../modules/expo-onebox';

const DATABASE_VERSION = 2;

export async function migrateDbIfNeeded(db: SQLiteDatabase) {
    const result = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
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

// Web: see kv.ts for why we lazy-require expo-sqlite instead of importing it.
export function DatabaseProvider({ children }: { children: React.ReactNode }) {
    if (Platform.OS === 'web') {
        return <>{children}</>;
    }
    if (Platform.OS === 'android') {
        ExpoOneBox.repairSQLiteDirectory();
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { SQLiteProvider } = require('expo-sqlite') as typeof import('expo-sqlite');
    return (
        <SQLiteProvider databaseName="config.db" onInit={migrateDbIfNeeded}>
            {children}
        </SQLiteProvider>
    );
}
