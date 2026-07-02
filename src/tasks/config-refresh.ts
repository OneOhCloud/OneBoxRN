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
import { classifyFetchError, errorCodeOf } from '@/utils/config-fetch-policy';
import { initializeVerificationData } from '@/utils/domain-verification';
import { newFlowId } from '@/utils/flow-events';
import { logFlowEvent, recordFlowFailure } from '@/utils/flow-log';
import { djb2Hash, redactUrl } from '@/utils/log-redact';
import { CONFIG_REFRESH_KEYS } from '@/constants/cache-keys';

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
    try {
        await pushRefreshOptionsToNative();
    } catch (e) {
        console.warn('[ConfigRefresh] refresh options mirror push error:', e);
    }
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
    applyResultToSBConfig(result, url, 'manual-direct', flowId);
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
            applyResultToSBConfig(result, url, 'auto', flowId);
        }
    } catch (e) {
        console.warn('[ConfigRefresh] syncNativeResultToJS error:', e);
    }
}

// ─── Internal ─────────────────────────────────────────────────────────────────

/** Native refresh error strings → shared errorCode vocabulary. */
function refreshErrorCode(error: string | undefined): string | undefined {
    if (!error) return undefined;
    const kind = classifyFetchError({ message: error });
    const httpMatch = error.match(/HTTP\s+(\d{3})/i);
    return errorCodeOf(kind, httpMatch ? Number(httpMatch[1]) : undefined);
}

function applyResultToSBConfig(
    result: ConfigRefreshResult,
    url: string,
    trigger: 'auto' | 'manual-direct',
    flowId: string,
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
        acceleratedUrlRedacted: result.actualUrl ? redactUrl(result.actualUrl) : undefined,
        flowId,
        upload: result.subscriptionUpload,
        download: result.subscriptionDownload,
        total: result.subscriptionTotal,
        expire: result.subscriptionExpire,
    });

    const event = {
        event: 'config_refresh' as const,
        flowId,
        phase: 'refresh' as const,
        status: result.status === 'success' ? ('ok' as const) : result.status === 'skipped' ? ('skip' as const) : ('fail' as const),
        method: result.method ?? 'primary',
        durationMs: result.durationMs,
        errorCode: refreshErrorCode(result.error),
        profileIdHash: djb2Hash(url),
        detail: `trigger=${trigger} contentChanged=${contentChanged}`,
    };
    if (event.status === 'fail') {
        recordFlowFailure(event);
    } else {
        logFlowEvent(event);
    }
}
