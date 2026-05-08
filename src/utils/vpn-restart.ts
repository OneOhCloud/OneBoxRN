/**
 * Shared stop-and-restart helper for the VPN tunnel.
 *
 * Both the mode selector (`VpnContext.setMode`) and the profile list
 * (`profile.tsx handleActivate`) need to restart the tunnel with a freshly
 * processed sing-box config whenever the user changes something. Each of them
 * used to run an independent `stop → wait for STOPPED → start` sequence.
 *
 * Rapid switching (mode + profile, or tapping the list quickly) produced two
 * bugs:
 *
 * 1. Multiple in-flight listeners racing to call `ExpoOneBox.start()` — the
 *    native side received two concurrent starts and the tunnel came up in a
 *    half-broken state, or the second start was silently dropped.
 * 2. The stop fired before the user's final choice was persisted, so the
 *    restart picked up a stale config.
 *
 * This module serialises all restart requests:
 *
 *  - A short **debounce window** (default 250 ms) collapses bursts of taps
 *    into a single restart — by then the user's final choice is already in
 *    the KV store, and `getProcessedConfig()` will read the latest state.
 *  - An **in-flight guard** prevents a second stop/start cycle from starting
 *    while one is already running. Any request that arrives during the
 *    in-flight window sets a `needsReRun` flag, and the finally block
 *    schedules exactly one more restart when the current one completes.
 *
 * Net effect: no matter how many times the user taps, we run the minimum
 * number of restarts needed to reach the final state, and we never fire two
 * starts in parallel.
 */

import { getProcessedConfig } from '@/database/helper';
import ExpoOneBox, { VPN_STATUS } from '@/modules/expo-onebox';

const DEBOUNCE_MS = 250;
const STOP_TIMEOUT_MS = 10_000;
const REARM_DELAY_MS = 400;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;
let needsReRun = false;

/**
 * Ask the VPN tunnel to restart with the freshest config. Safe to call
 * repeatedly — calls within the debounce window collapse into a single
 * restart, and calls during an in-flight restart queue exactly one follow-up.
 *
 * Returns immediately if the tunnel is not currently running (or starting).
 * In that case the caller's own `setMode` / `setActiveId` write is already
 * enough — the next manual connect will pick up the new state.
 */
export function requestVpnRestart(): void {
    const status = ExpoOneBox.getStatus();
    const shouldRestart = status === VPN_STATUS.STARTED || status === VPN_STATUS.STARTING;
    if (!shouldRestart) return;

    if (inFlight) {
        needsReRun = true;
        return;
    }

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        debounceTimer = null;
        runRestartCycle();
    }, DEBOUNCE_MS);
}

function runRestartCycle(): void {
    // Re-check status — user may have tapped Disconnect during the debounce.
    const status = ExpoOneBox.getStatus();
    if (status !== VPN_STATUS.STARTED && status !== VPN_STATUS.STARTING) return;

    inFlight = true;
    needsReRun = false;

    let settled = false;
    const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        sub.remove();

        getProcessedConfig()
            .then(config => ExpoOneBox.start(config))
            .catch(e => console.warn('[VPN] Restart failed:', e))
            .finally(() => {
                inFlight = false;
                if (needsReRun) {
                    needsReRun = false;
                    // Give the freshly-started tunnel a moment to transition
                    // into STARTING before we immediately stop it again.
                    setTimeout(runRestartCycle, REARM_DELAY_MS);
                }
            });
    };

    const sub = ExpoOneBox.addListener('onStatusChange', (e: { status: number }) => {
        if (e.status === VPN_STATUS.STOPPED) finish();
    });
    const timer = setTimeout(() => {
        console.warn('[VPN] Restart: stop timeout, restarting anyway');
        finish();
    }, STOP_TIMEOUT_MS);

    ExpoOneBox.stop().catch(() => setTimeout(finish, 300));
}
