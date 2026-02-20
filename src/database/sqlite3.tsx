
import { SQLiteProvider, type SQLiteDatabase } from 'expo-sqlite';
import {
    Platform,
    UIManager
} from 'react-native';
// 启用 LayoutAnimation (Android)
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

// 数据库初始化函数
async function migrateDbIfNeeded(db: SQLiteDatabase) {
    const DATABASE_VERSION = 1;
    const result = await db.getFirstAsync<{ user_version: number }>(
        'PRAGMA user_version'
    );
    let currentDbVersion = result?.user_version ?? 0;

    if (currentDbVersion >= DATABASE_VERSION) {
        return;
    }

    if (currentDbVersion === 0) {
        // 设置 WAL 模式以提高性能
        await db.execAsync(`
            PRAGMA journal_mode = WAL;
            
            CREATE TABLE subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                identifier TEXT NOT NULL UNIQUE,
                name TEXT,
                used_traffic INTEGER DEFAULT 0,
                total_traffic INTEGER DEFAULT 1,
                subscription_url TEXT,
                official_website TEXT,
                expire_time INTEGER DEFAULT (strftime('%s', 'now', '+30 days')),
                last_update_time INTEGER DEFAULT (strftime('%s', 'now'))
            );
            
            CREATE TABLE subscription_configs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                identifier TEXT NOT NULL,
                config_content TEXT,
                FOREIGN KEY (identifier) REFERENCES subscriptions(identifier) ON DELETE CASCADE
            );
            
            PRAGMA foreign_keys = ON;
        `);

        currentDbVersion = 1;
    }

    await db.execAsync(`PRAGMA user_version = ${DATABASE_VERSION}`);
}

// 使用示例
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function Demo({ children }: { children: React.ReactNode }) {
    return (
        <SQLiteProvider databaseName="config.db" onInit={migrateDbIfNeeded}>
            {children}
        </SQLiteProvider>
    );
}
