/**
 * Background config refresh task.
 * Registered once at app start; runs every ~15 minutes (system-scheduled).
 * If a subscription URL is stored, re-fetches it and updates SBConfig.
 */
import * as BackgroundTask from 'expo-background-task';
import { BackgroundTaskResult } from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { fetch } from 'expo/fetch';

import { SBConfig, TaskLog } from '@/database/kv';
import type { TaskStatus } from '@/database/kv';
import { getSingBoxUserAgent } from '@/utils';
import { parseSubscriptionUserinfo } from '@/utils/subscription';

export const CONFIG_REFRESH_TASK = 'config-refresh';

// ─── Task Body ───────────────────────────────────────────────────────────────
// Extracted so it can be invoked directly from the dev screen for testing,
// since triggerTaskWorkerForTestingAsync skips execution when the app is in foreground.

export async function executeConfigRefresh(): Promise<BackgroundTaskResult> {
    console.log('[ConfigRefresh] ⚡ task triggered at', new Date().toISOString());
    const start = Date.now();
    const url = SBConfig.getConfigLink();

    if (!url) {
        console.log('[ConfigRefresh] no config URL set, skipping');
        return BackgroundTaskResult.Success;
    }

    console.log('[ConfigRefresh] fetching config from:', url.substring(0, 50) + '...');

    let status: TaskStatus = 'success';
    let detail: string | undefined;

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                'User-Agent': getSingBoxUserAgent(),
            },
        });

        if (!response.ok) {
            status = 'failed';
            detail = `HTTP ${response.status}`;
            return BackgroundTaskResult.Failed;
        }

        const content = await response.text();

        // Skip write if content hasn't changed
        if (content === SBConfig.getConfigContent()) {
            status = 'skipped';
            detail = 'Content unchanged';
            return BackgroundTaskResult.Success;
        }

        const info = parseSubscriptionUserinfo(response.headers.get('subscription-userinfo'));

        SBConfig.setConfigContent(content);
        SBConfig.setUsedTraffic(info.upload + info.download);
        SBConfig.setTotalTraffic(info.total);
        SBConfig.setExpireTime(info.expire);

        detail = 'Config updated';
        console.log('[ConfigRefresh] config updated successfully');
        return BackgroundTaskResult.Success;
    } catch (e) {
        status = 'failed';
        detail = e instanceof Error ? e.message : String(e);
        console.warn('[ConfigRefresh] task error:', e);
        return BackgroundTaskResult.Failed;
    } finally {
        console.log(`[ConfigRefresh] task finished: status=${status}, duration=${Date.now() - start}ms`);
        TaskLog.append(url, {
            time: new Date(start).toISOString(),
            status,
            duration: Date.now() - start,
            detail,
        });
    }
}

// ─── Task Definition ─────────────────────────────────────────────────────────
// Must be called at module top level (outside any component).

TaskManager.defineTask(CONFIG_REFRESH_TASK, async () => {
    return executeConfigRefresh();
});

// ─── Registration ─────────────────────────────────────────────────────────────

export async function registerConfigRefreshTask() {
    try {
        const status = await BackgroundTask.getStatusAsync();
        console.log('[ConfigRefresh] system background task status:', status);
        if (status === BackgroundTask.BackgroundTaskStatus.Restricted) {
            console.log('[ConfigRefresh] background tasks RESTRICTED, cannot register');
            return;
        }

        // Always unregister + re-register to ensure a fresh WorkManager job exists.
        // WorkManager OneTimeWorkRequest is cancelled by force-stop (swipe away),
        // and `isTaskRegisteredAsync` may return true even when the job is gone.
        const isRegistered = await TaskManager.isTaskRegisteredAsync(CONFIG_REFRESH_TASK);
        console.log('[ConfigRefresh] task already registered:', isRegistered);
        if (isRegistered) {
            await BackgroundTask.unregisterTaskAsync(CONFIG_REFRESH_TASK);
            console.log('[ConfigRefresh] unregistered stale task');
        }
        await BackgroundTask.registerTaskAsync(CONFIG_REFRESH_TASK, {
            minimumInterval: 15, // 15 minutes (unit: minutes, minimum allowed)
        });
        console.log('[ConfigRefresh] task registered successfully');
    } catch (e) {
        console.warn('[ConfigRefresh] registration error:', e);
    }
}
