import { SQLiteProvider, type SQLiteDatabase } from 'expo-sqlite';
import { Platform, UIManager } from 'react-native';

// 启用 LayoutAnimation (Android)
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

const DATABASE_VERSION = 2;

// 数据库初始化/迁移函数 — 供 SQLiteProvider onInit 调用
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
export function DatabaseProvider({ children }: { children: React.ReactNode }) {
    return (
        <SQLiteProvider databaseName="config.db" onInit={migrateDbIfNeeded}>
            {children}
        </SQLiteProvider>
    );
}
