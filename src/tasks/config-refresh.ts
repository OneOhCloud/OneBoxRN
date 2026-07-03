/**
 * 后台配置刷新 —— 原生实现。
 *
 * 真正的周期性后台工作完全在原生侧运行：
 *   iOS:     BGAppRefreshTask (BackgroundConfigRefresh.swift)
 *   Android: WorkManager CoroutineWorker (BackgroundConfigWorker.kt)
 *
 * 本模块提供面向 JS 的 API：注册/注销原生任务、触发前台刷新，并在应用回到
 * 前台时把原生结果同步进 ProfileConfig。
 */
import type { ConfigRefreshResult } from '@/modules/expo-onebox/src/ExpoOneBox.types';
import Constants from 'expo-constants';
import ExpoOneBox from '@/modules/expo-onebox';
import { ProfileConfig, TaskLog, kvGet, kvSet } from '@/database/kv';
import { getSingBoxUserAgent } from '@/utils';
import { initializeVerificationData } from '@/utils/domain-verification';
import { newFlowId } from '@/utils/flow-events';
import { logFlowEvent, recordFlowFailure } from '@/utils/flow-log';
import { CONFIG_REFRESH_KEYS } from '@/constants/cache-keys';
import { applyRefreshResult, type RefreshApplyDeps } from './config-refresh-core';

const ACCELERATE_URL: string | null =
    (Constants.expoConfig?.extra?.accelerateUrl as string | null) || null;

export const CONFIG_REFRESH_TASK = 'config-refresh';

// ─── 初始化 ───────────────────────────────────────────────────────────

/**
 * 把刷新选项镜像进原生后台 worker 的共享存储（AppGroup UserDefaults /
 * SharedPreferences）。worker 绝不能直接读取 JS 拥有的 SQLite 数据库 ——
 * 同一 WAL 文件上再挂一个 SQLite 库会破坏进程内 POSIX 锁，并以 SIGBUS 崩溃。
 */
async function pushRefreshOptionsToNative(): Promise<void> {
    await ExpoOneBox.setBackgroundConfigRefreshOptions({
        accelerateUrl: ACCELERATE_URL ?? '',
        testPrimaryUrlUnavailable: getTestPrimaryUrlUnavailable(),
    });
}

/**
 * 应用启动时初始化配置刷新系统。
 * 先把刷新选项推入原生，再拉取并缓存域名验证数据。
 */
export async function initializeConfigRefresh(): Promise<void> {
    // 两项互不依赖的启动工作 —— 并发执行，让原生选项推送不拖慢验证数据拉取。
    // 各自保留 catch，任一失败都不会拖累另一个 reject。
    await Promise.all([
        pushRefreshOptionsToNative().catch((e) =>
            console.warn('[ConfigRefresh] refresh options mirror push error:', e)),
        initializeVerificationData().catch((e) =>
            console.warn('[ConfigRefresh] initialization error:', e)),
    ]);
}

// ─── 开发设置 ─────────────────────────────────────────────────────────────

export function getTestPrimaryUrlUnavailable(): boolean {
    return kvGet(CONFIG_REFRESH_KEYS.TEST_PRIMARY_URL_UNAVAILABLE) === 'true';
}

export function setTestPrimaryUrlUnavailable(enabled: boolean): void {
    kvSet(CONFIG_REFRESH_KEYS.TEST_PRIMARY_URL_UNAVAILABLE, enabled ? 'true' : 'false');
    pushRefreshOptionsToNative().catch((e) =>
        console.warn('[ConfigRefresh] refresh options mirror push error:', e));
}

// ─── 注册 ─────────────────────────────────────────────────────────────

/**
 * 注册（或更新）原生的周期性后台配置刷新。
 * 尚未存储配置 URL 时无操作。
 * 原生从 JS 推入的共享选项里读取加速代理 URL。
 * 原生先试主 URL；遇到网络层错误（非 HTTP 错误）时，若域名在 sha256 白名单上，
 * 就改走加速代理 URL 重试。
 * 详见 ios/core/BackgroundConfigRefresh.swift + android/.../BackgroundConfigWorker.kt。
 */
export async function registerConfigRefreshTask(): Promise<void> {
    const url = ProfileConfig.getConfigLink();
    if (!url) {
        console.log('[ConfigRefresh] no config URL set, skipping registration');
        return;
    }
    try {
        console.log('[ConfigRefresh] registering background task');
        await ExpoOneBox.registerBackgroundConfigRefresh(url, getSingBoxUserAgent(), 1800);
        console.log('[ConfigRefresh] background task registered');
    } catch (e) {
        console.warn('[ConfigRefresh] registration error:', e);
    }
}

// ─── 前台执行 ─────────────────────────────────────────────────────

/**
 * 立即执行一次配置刷新（前台 / dev 屏）。
 * 核心逻辑（统一）：
 *   1. 试主 URL
 *   2. 失败且域名已验证 → 回落到加速代理 URL
 *   3. 返回带方式信息的结果
 *
 * 测试模式：模拟主 URL 不可用，用于测试回落路径。
 */
export async function executeConfigRefresh(): Promise<ConfigRefreshResult | null> {
    const url = ProfileConfig.getConfigLink();
    if (!url) {
        console.log('[ConfigRefresh] no config URL, skipping');
        return null;
    }

    const testMode = getTestPrimaryUrlUnavailable();
    const testModeMsg = testMode ? ' [TEST MODE: primary unavailable, native reads shared options]' : '';
    console.log(`[ConfigRefresh] executing foreground refresh…${testModeMsg}`);

    const flowId = newFlowId();
    logFlowEvent({ event: 'config_refresh', flowId, phase: 'refresh', status: 'start' });
    const result = await ExpoOneBox.executeConfigRefreshNow(url, getSingBoxUserAgent());
    applyRefreshResult(refreshApplyDeps, { result, url, trigger: 'manual-direct', flowId });
    return result;
}

// ─── 前台同步 ──────────────────────────────────────────────────────────

/**
 * 读取并清除原生后台任务存储的最近一次结果，然后应用到 ProfileConfig。
 * 每次应用回到前台时调用，让 UI 状态反映后台执行过的刷新。
 */
export function syncNativeResultToJS(): void {
    try {
        const result = ExpoOneBox.getLastConfigRefreshResult();
        if (!result) return;
        const url = ProfileConfig.getConfigLink();
        if (url) {
            const flowId = newFlowId();
            logFlowEvent({ event: 'config_refresh', flowId, phase: 'sync', status: 'start' });
            applyRefreshResult(refreshApplyDeps, { result, url, trigger: 'auto', flowId });
        }
    } catch (e) {
        console.warn('[ConfigRefresh] syncNativeResultToJS error:', e);
    }
}

// ─── 内部 ─────────────────────────────────────────────────────────────────

// 应用逻辑在 config-refresh-core.ts（纯函数，node:test 覆盖）；
// 这里是它唯一的生产接线点。
const refreshApplyDeps: RefreshApplyDeps = {
    sbConfig: ProfileConfig,
    taskLog: TaskLog,
    logFlowEvent,
    recordFlowFailure,
};
