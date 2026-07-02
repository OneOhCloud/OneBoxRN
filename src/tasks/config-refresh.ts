/**
 * Background config refresh — native implementation.
 *
 * The actual periodic background work runs fully natively:
 *   iOS:     BGAppRefreshTask (BackgroundConfigRefresh.swift)
 *   Android: WorkManager CoroutineWorker (BackgroundConfigWorker.kt)
 *
 * This module provides the JS-facing API to register/unregister the native task,
 * trigger a foreground refresh, and sync native results into SBConfig when
 * the app foregrounds.
 */
import type { ConfigRefreshResult } from '@/modules/expo-onebox/src/ExpoOneBox.types';
import Constants from 'expo-constants';
import ExpoOneBox from '@/modules/expo-onebox';
import { SBConfig, TaskLog, kvGet, kvSet } from '@/database/kv';
import { getSingBoxUserAgent } from '@/utils';
import { initializeVerificationData } from '@/utils/domain-verification';
import { newFlowId } from '@/utils/flow-events';
import { logFlowEvent, recordFlowFailure } from '@/utils/flow-log';
import { CONFIG_REFRESH_KEYS } from '@/constants/cache-keys';
import { applyRefreshResult, type RefreshApplyDeps } from './config-refresh-core';

const ACCELERATE_URL: string | null =
    (Constants.expoConfig?.extra?.accelerateUrl as string | null) || null;

export const CONFIG_REFRESH_TASK = 'config-refresh';

// ─── Initialization ───────────────────────────────────────────────────────────

/**
 * Mirror the refresh options into the native background worker's shared
 * store (AppGroup UserDefaults / SharedPreferences). The worker must never
 * read the JS-owned SQLite database directly — a second SQLite library on
 * the same WAL file breaks in-process POSIX locking and crashes with SIGBUS.
 */
async function pushRefreshOptionsToNative(): Promise<void> {
    await ExpoOneBox.setBackgroundConfigRefreshOptions({
        accelerateUrl: ACCELERATE_URL ?? '',
        testPrimaryUrlUnavailable: getTestPrimaryUrlUnavailable(),
    });
}

/**
 * Initialize config refresh system on app startup.
 * Pushes refresh options to native, then fetches and caches domain
 * verification data.
 */
export async function initializeConfigRefresh(): Promise<void> {
    // Independent startup work — run concurrently so the native options push
    // does not delay the verification-data fetch. Each keeps its own catch so
    // one failing never rejects the other.
    await Promise.all([
        pushRefreshOptionsToNative().catch((e) =>
            console.warn('[ConfigRefresh] refresh options mirror push error:', e)),
        initializeVerificationData().catch((e) =>
            console.warn('[ConfigRefresh] initialization error:', e)),
    ]);
}

// ─── Dev settings ─────────────────────────────────────────────────────────────

export function getTestPrimaryUrlUnavailable(): boolean {
    return kvGet(CONFIG_REFRESH_KEYS.TEST_PRIMARY_URL_UNAVAILABLE) === 'true';
}

export function setTestPrimaryUrlUnavailable(enabled: boolean): void {
    kvSet(CONFIG_REFRESH_KEYS.TEST_PRIMARY_URL_UNAVAILABLE, enabled ? 'true' : 'false');
    pushRefreshOptionsToNative().catch((e) =>
        console.warn('[ConfigRefresh] refresh options mirror push error:', e));
}

// ─── Registration ─────────────────────────────────────────────────────────────

/**
 * Register (or update) the native periodic background config refresh.
 * No-ops if no config URL is stored yet.
 * Native reads the accelerate URL from the JS-pushed shared options.
 * Native tries primary first; on network-level error (not HTTP error), if the
 * domain is on the SHA256 allowlist, it retries via the accelerate URL.
 * See ios/core/BackgroundConfigRefresh.swift + android/.../BackgroundConfigWorker.kt.
 */
export async function registerConfigRefreshTask(): Promise<void> {
    const url = SBConfig.getConfigLink();
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

// ─── Foreground execution ─────────────────────────────────────────────────────

/**
 * Execute a config refresh immediately (foreground / dev screen).
 * Core logic (unified):
 *   1. Try primary URL
 *   2. If fails and domain is verified → fallback to accelerate URL
 *   3. Return result with method info
 *
 * Test mode: simulates primary URL unavailable to test fallback path.
 */
export async function executeConfigRefresh(): Promise<ConfigRefreshResult | null> {
    const url = SBConfig.getConfigLink();
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

// ─── Foreground sync ──────────────────────────────────────────────────────────

/**
 * Read and clear the last result stored by the native background task, then
 * apply it to SBConfig. Call this whenever the app returns to foreground
 * so UI state reflects background-executed refreshes.
 */
export function syncNativeResultToJS(): void {
    try {
        const result = ExpoOneBox.getLastConfigRefreshResult();
        if (!result) return;
        const url = SBConfig.getConfigLink();
        if (url) {
            const flowId = newFlowId();
            logFlowEvent({ event: 'config_refresh', flowId, phase: 'sync', status: 'start' });
            applyRefreshResult(refreshApplyDeps, { result, url, trigger: 'auto', flowId });
        }
    } catch (e) {
        console.warn('[ConfigRefresh] syncNativeResultToJS error:', e);
    }
}

// ─── Internal ─────────────────────────────────────────────────────────────────

// Apply logic lives in config-refresh-core.ts (pure, node:test covered);
// this is its one production wiring point.
const refreshApplyDeps: RefreshApplyDeps = {
    sbConfig: SBConfig,
    taskLog: TaskLog,
    logFlowEvent,
    recordFlowFailure,
};
