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
import { CONFIG_REFRESH_KEYS } from '@/constants/cache-keys';

const ACCELERATE_URL: string | null =
    (Constants.expoConfig?.extra?.accelerateUrl as string | null) || null;

export const CONFIG_REFRESH_TASK = 'config-refresh';

// ─── Initialization ───────────────────────────────────────────────────────────

/**
 * Initialize config refresh system on app startup.
 * Fetches and caches domain verification data.
 */
export async function initializeConfigRefresh(): Promise<void> {
    kvSet(CONFIG_REFRESH_KEYS.ACCELERATE_URL, ACCELERATE_URL ?? '');
    try {
        await initializeVerificationData();
    } catch (e) {
        console.warn('[ConfigRefresh] initialization error:', e);
    }
}

// ─── Dev settings ─────────────────────────────────────────────────────────────

export function getTestPrimaryUrlUnavailable(): boolean {
    return kvGet(CONFIG_REFRESH_KEYS.TEST_PRIMARY_URL_UNAVAILABLE) === 'true';
}

export function setTestPrimaryUrlUnavailable(enabled: boolean): void {
    kvSet(CONFIG_REFRESH_KEYS.TEST_PRIMARY_URL_UNAVAILABLE, enabled ? 'true' : 'false');
}

// ─── Registration ─────────────────────────────────────────────────────────────

/**
 * Register (or update) the native periodic background config refresh.
 * No-ops if no config URL is stored yet.
 * Native reads accelerate URL from kv_store (`config:accelerate-url`).
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
    const testModeMsg = testMode ? ' [TEST MODE: primary unavailable, native reads kv_store]' : '';
    console.log(`[ConfigRefresh] executing foreground refresh…${testModeMsg}`);

    const result = await ExpoOneBox.executeConfigRefreshNow(url, getSingBoxUserAgent());
    applyResultToSBConfig(result, url, 'manual-direct');
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
            applyResultToSBConfig(result, url, 'auto');
        }
    } catch (e) {
        console.warn('[ConfigRefresh] syncNativeResultToJS error:', e);
    }
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function applyResultToSBConfig(
    result: ConfigRefreshResult,
    url: string,
    trigger: 'auto' | 'manual-direct',
): void {
    let contentChanged = false;
    if (result.status === 'success') {
        SBConfig.setUsedTraffic(result.subscriptionUpload + result.subscriptionDownload);
        SBConfig.setTotalTraffic(result.subscriptionTotal);
        SBConfig.setExpireTime(result.subscriptionExpire);
        if (result.content && result.content !== SBConfig.getConfigContent()) {
            SBConfig.setConfigContent(result.content);
            contentChanged = true;
        }
    }

    TaskLog.append(url, {
        time: result.timestamp,
        status: result.status as 'success' | 'failed' | 'skipped',
        trigger,
        duration: result.durationMs,
        method: result.method ?? 'primary',
        contentChanged,
        error: result.error,
        primaryUrl: url,
        acceleratedUrl: result.actualUrl,
        upload: result.subscriptionUpload,
        download: result.subscriptionDownload,
        total: result.subscriptionTotal,
        expire: result.subscriptionExpire,
        userinfoHeader: result.subscriptionUserinfoHeader,
    });

    console.log(`[ConfigRefresh] applied: status=${result.status}, method=${result.method ?? 'primary'}, duration=${result.durationMs}ms`);
}
