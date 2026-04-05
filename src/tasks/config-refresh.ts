/**
 * Background config refresh — native implementation.
 *
 * The actual periodic background work runs fully natively:
 *   iOS:     BGAppRefreshTask (BackgroundConfigRefresh.swift)
 *   Android: WorkManager CoroutineWorker (BackgroundConfigWorker.kt)
 *
 * This module provides the JS-facing API to register/unregister the native task,
 * trigger a foreground refresh, and sync native results into SBConfig (MMKV) when
 * the app foregrounds.
 */
import type { ConfigRefreshResult } from '@/modules/expo-onebox/src/ExpoOneBox.types';
import ExpoOneBox from '@/modules/expo-onebox';
import { SBConfig, TaskLog } from '@/database/kv';
import { getSingBoxUserAgent } from '@/utils';

export const CONFIG_REFRESH_TASK = 'config-refresh';

// ─── Registration ─────────────────────────────────────────────────────────────

/**
 * Register (or update) the native periodic background config refresh.
 * No-ops if no config URL is stored yet.
 */
export async function registerConfigRefreshTask(): Promise<void> {
    const url = SBConfig.getConfigLink();
    if (!url) {
        console.log('[ConfigRefresh] no config URL set, skipping registration');
        return;
    }
    try {
        await ExpoOneBox.registerBackgroundConfigRefresh(url, getSingBoxUserAgent(), 1800);
        console.log('[ConfigRefresh] native background task registered');
    } catch (e) {
        console.warn('[ConfigRefresh] registration error:', e);
    }
}

// ─── Foreground execution ─────────────────────────────────────────────────────

/**
 * Execute a config refresh immediately (foreground / dev screen).
 * Uses the native DNS-resolved fetcher (NWConnection + custom SNI) on iOS.
 */
export async function executeConfigRefresh(): Promise<ConfigRefreshResult | null> {
    const url = SBConfig.getConfigLink();
    if (!url) {
        console.log('[ConfigRefresh] no config URL, skipping');
        return null;
    }
    console.log('[ConfigRefresh] executing foreground refresh…');
    const result = await ExpoOneBox.executeConfigRefreshNow(url, getSingBoxUserAgent());
    applyResultToSBConfig(result, url, 'manual-direct');
    return result;
}

// ─── Foreground sync ──────────────────────────────────────────────────────────

/**
 * Read and clear the last result stored by the native background task, then
 * apply it to SBConfig (MMKV). Call this whenever the app returns to foreground
 * so UI state reflects background-executed refreshes.
 */
export function syncNativeResultToJS(): void {
    try {
        const result = ExpoOneBox.getLastConfigRefreshResult();
        if (!result) return;
        const url = SBConfig.getConfigLink();
        if (url) applyResultToSBConfig(result, url, 'auto');
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
    if (result.status === 'success') {
        SBConfig.setUsedTraffic(result.subscriptionUpload + result.subscriptionDownload);
        SBConfig.setTotalTraffic(result.subscriptionTotal);
        SBConfig.setExpireTime(result.subscriptionExpire);
        if (result.content && result.content !== SBConfig.getConfigContent()) {
            SBConfig.setConfigContent(result.content);
        }
    }

    TaskLog.append(url, {
        time: result.timestamp,
        status: result.status as 'success' | 'failed' | 'skipped',
        trigger,
        duration: result.durationMs,
        detail: result.error,
    });

    console.log(`[ConfigRefresh] result applied: status=${result.status}, duration=${result.durationMs}ms`);
}
