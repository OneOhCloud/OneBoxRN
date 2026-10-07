package cloud.oneoh.oneboxn

import android.content.Context
import android.content.SharedPreferences
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteException
import android.util.Log
import androidx.core.content.edit
import cloud.oneoh.oneboxn.core.LegacyImport
import cloud.oneoh.oneboxn.core.ProfileStore
import cloud.oneoh.oneboxn.core.RuleStore
import java.io.File
import java.util.UUID

/**
 * 上一代应用的数据一次性导入：覆盖安装升级后首次加载数据时跑一次，之后永不再跑。
 *
 * 上一代把全部状态存在应用私有目录下 `SQLite/config.db` 的 `kv_store(key, value)` 表里；
 * 本类只读不写那份库，换算与落库是 core [LegacyImport] 的事。没有那份库（全新安装）也记成已完成。
 * 读库失败不记完成：下次启动再试，而不是把用户的配置永久丢在旧库里。
 */
class LegacyDataImport(
    private val context: Context,
    private val preferences: SharedPreferences,
    private val routingModeStore: RoutingModeStore,
) {
    fun run(profiles: ProfileStore, rules: RuleStore) {
        if (preferences.getBoolean(DONE_KEY, false)) return
        val database = File(context.filesDir, LEGACY_DATABASE)
        if (database.exists()) {
            val entries = try {
                readEntries(database)
            } catch (failure: SQLiteException) {
                Log.w(TAG, "legacy data unreadable, will retry next launch: ${failure.message}")
                return
            }
            val plan = LegacyImport.plan(entries)
            LegacyImport.apply(plan, profiles, rules, newId = { UUID.randomUUID().toString() }, nowMillis = System.currentTimeMillis())
            plan.routingMode?.let(routingModeStore::set)
            Log.i(TAG, "legacy data imported: profiles=${plan.profiles.size} rules=${plan.rules.size}")
        }
        preferences.edit { putBoolean(DONE_KEY, true) }
    }

    private fun readEntries(database: File): Map<String, String> =
        SQLiteDatabase.openDatabase(database.path, null, SQLiteDatabase.OPEN_READONLY).use { db ->
            db.rawQuery("SELECT key, value FROM kv_store", null).use { cursor ->
                buildMap {
                    while (cursor.moveToNext()) {
                        if (!cursor.isNull(1)) put(cursor.getString(0), cursor.getString(1))
                    }
                }
            }
        }

    private companion object {
        const val TAG = "LegacyDataImport"
        const val DONE_KEY = "legacy-import-done"
        const val LEGACY_DATABASE = "SQLite/config.db"
    }
}
