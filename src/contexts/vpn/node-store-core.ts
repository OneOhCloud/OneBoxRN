/**
 * Proxy-node state store core — pure, dependency-free.
 *
 * Owns the node list / current node / auto-resolved node / testing
 * window that `use-proxy-nodes.ts` previously kept in component state
 * with its own duplicate `onGroupUpdate` listener. The single native
 * listener in VpnContext now feeds `applyGroupUpdate`; React reads via
 * `useSyncExternalStore` (see node-store.ts), mirroring the log-sink
 * pattern so high-frequency group updates never re-render `useVpn`
 * consumers.
 */

import type { TimerHandle, TimerHost } from './types.ts';
import { defaultTimers } from './types.ts';

// ─── Constants ───────────────────────────────────────────────

/** Tag of the proxy selector group in the sing-box config. */
export const GATEWAY_GROUP_TAG = 'ExitGateway';
/** Tag of the URLTest auto-select group nested inside ExitGateway. */
export const AUTO_GROUP_TAG = 'auto';

/** How long we treat delay=0 as "still testing" after an explicit trigger. */
export const TESTING_WINDOW_MS = 12_000;
/** Loading guard to avoid an endless spinner when URLTest stalls after resume. */
export const INITIAL_LOADING_TIMEOUT_MS = 8_000;

// ─── Types ───────────────────────────────────────────────────

export interface NodeItem {
    tag: string;
    delay: number;
    /** true while waiting for first URLTest results. */
    testing: boolean;
}

export interface NodeStoreState {
    nodes: NodeItem[];
    currentNode: string;
    autoResolvedNode: string | null;
    isLoading: boolean;
}

export interface GroupUpdate {
    all: { tag: string; delay: number }[];
    now: string;
    autoNow?: string;
}

export const EMPTY_NODE_STATE: NodeStoreState = {
    nodes: [],
    currentNode: '',
    autoResolvedNode: null,
    isLoading: false,
};

// ─── Reducer ─────────────────────────────────────────────────

/**
 * Pure mapping of one native group update onto the previous state.
 * Mirrors the previous use-proxy-nodes listener exactly:
 *  - delay=0 counts as "testing" only inside the explicit test window
 *    (delay=0 can also mean timeout / no sample);
 *  - an empty `now` keeps the previous selection;
 *  - `autoNow` overwrites every time ('' → null);
 *  - loading clears once any measured delay arrives or the window ends.
 */
export function reduceGroupUpdate(
    prev: NodeStoreState,
    event: GroupUpdate,
    now: number,
    testWindowUntil: number,
): NodeStoreState {
    const inTestingWindow = now < testWindowUntil;
    const hasAnyMeasuredDelay = event.all.some((n) => n.delay > 0);
    return {
        nodes: event.all.map((n) => ({
            ...n,
            testing: inTestingWindow && n.delay === 0,
        })),
        currentNode: event.now ? event.now : prev.currentNode,
        autoResolvedNode: event.autoNow || null,
        isLoading: hasAnyMeasuredDelay || !inTestingWindow ? false : prev.isLoading,
    };
}

// ─── Store ───────────────────────────────────────────────────

export interface NodeStore {
    getSnapshot(): NodeStoreState;
    subscribe(listener: () => void): () => void;
    applyGroupUpdate(event: GroupUpdate): void;
    /** Marks loading, opens the 12 s testing window, (re)arms the 8 s guard. */
    beginTestingWindow(): void;
    /** Optimistic selection after a successful native selectProxyNode. */
    markCurrentNode(tag: string): void;
    /** Clears state + guard timer (on disconnect / profile change). */
    reset(): void;
}

export function createNodeStore(deps?: {
    now?: () => number;
    timers?: TimerHost;
}): NodeStore {
    const now = deps?.now ?? Date.now;
    const timers = deps?.timers ?? defaultTimers;

    let state = EMPTY_NODE_STATE;
    let testWindowUntil = 0;
    let loadingGuard: TimerHandle | null = null;
    const listeners = new Set<() => void>();

    function setState(next: NodeStoreState): void {
        state = next;
        listeners.forEach((listener) => listener());
    }

    function clearGuard(): void {
        if (loadingGuard !== null) {
            timers.clearTimeout(loadingGuard);
            loadingGuard = null;
        }
    }

    return {
        getSnapshot: () => state,
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        applyGroupUpdate(event) {
            setState(reduceGroupUpdate(state, event, now(), testWindowUntil));
        },
        beginTestingWindow() {
            testWindowUntil = now() + TESTING_WINDOW_MS;
            clearGuard();
            loadingGuard = timers.setTimeout(() => {
                loadingGuard = null;
                if (state.isLoading) setState({ ...state, isLoading: false });
            }, INITIAL_LOADING_TIMEOUT_MS);
            if (!state.isLoading) setState({ ...state, isLoading: true });
        },
        markCurrentNode(tag) {
            setState({ ...state, currentNode: tag });
        },
        reset() {
            clearGuard();
            testWindowUntil = 0;
            setState(EMPTY_NODE_STATE);
        },
    };
}
