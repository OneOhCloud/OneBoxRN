import ExpoOneBox from '@/modules/expo-onebox';
import { useEffect, useState } from 'react';

// ─── Constants ───────────────────────────────────────────────

const POLL_INTERVAL = 10000;
const POLL_INITIAL_DELAY = 500;

// ─── Types ───────────────────────────────────────────────────

export interface NodeItem {
    tag: string;
    delay: number;
}

export interface ProxyNodesState {
    nodes: NodeItem[];
    currentNode: string;
    isLoading: boolean;
    error: string | null;
    setCurrentNode: (tag: string) => void;
}

// ─── Singleton Polling Manager ────────────────────────────────
//
// A single module-level polling loop shared across all hook instances.
// This eliminates the root cause of goroutine accumulation:
//   - Only ONE LibboxCommandClient connection exists at any given time.
//   - The next request starts only AFTER the current one resolves (sequential).
//   - If a request completes in < POLL_INTERVAL, we wait for the remainder;
//     if it takes longer (slow/timeout), the next request fires immediately.
//
// Without a singleton, each React component instance (or StrictMode double-
// invoke) would run its own polling loop concurrently, multiplying connections.

interface PollState {
    nodes: NodeItem[];
    currentNode: string;
    isLoading: boolean;
    error: string | null;
}

type Listener = (state: PollState) => void;

// Shared state
let _state: PollState = { nodes: [], currentNode: '', isLoading: false, error: null };
const _listeners = new Set<Listener>();

// Polling control
let _loopGeneration = 0;   // incremented on each startPolling() to invalidate stale loops
let _sleepTimer: ReturnType<typeof setTimeout> | null = null;
let _isRunning = false;

function _setState(patch: Partial<PollState>) {
    _state = { ..._state, ...patch };
    _listeners.forEach(fn => fn(_state));
}

function _cancelSleep() {
    if (_sleepTimer !== null) {
        clearTimeout(_sleepTimer);
        _sleepTimer = null;
    }
}

function _sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
        _sleepTimer = setTimeout(() => {
            _sleepTimer = null;
            resolve();
        }, ms);
    });
}

async function _runLoop(generation: number) {
    _isRunning = true;
    let failCount = 0;

    // Initial delay before the first request
    await _sleep(POLL_INITIAL_DELAY);

    while (generation === _loopGeneration) {
        const start = Date.now();

        try {
            const res = await ExpoOneBox.getProxyNodes();

            // Discard result if this generation was superseded while awaiting
            if (generation !== _loopGeneration) break;

            failCount = 0;
            _setState({
                nodes: res.all ?? [],
                currentNode: res.now ?? '',
                isLoading: false,
                error: null,
            });
        } catch (e: unknown) {
            if (generation !== _loopGeneration) break;

            failCount++;
            const msg = e instanceof Error ? e.message : String(e);
            console.warn('[NodePoll] error', failCount, msg);
            if (failCount >= 3) {
                _setState({ error: msg || '无法获取节点列表', isLoading: false });
            }
        }

        if (generation !== _loopGeneration) break;

        // Wait for the remainder of the 2s window.
        // If the request already took >= 2s, proceed immediately.
        const elapsed = Date.now() - start;
        const remaining = POLL_INTERVAL - elapsed;
        if (remaining > 0) {
            await _sleep(remaining);
        }
    }

    if (generation === _loopGeneration) {
        _isRunning = false;
    }
}

function _startPolling() {
    _loopGeneration++;              // invalidates any in-flight loop from previous generation
    _cancelSleep();
    _setState({ isLoading: true, nodes: [], currentNode: '', error: null });
    _runLoop(_loopGeneration);
}

function _stopPolling() {
    _loopGeneration++;              // invalidates current loop
    _cancelSleep();
    _isRunning = false;
    _state = { nodes: [], currentNode: '', isLoading: false, error: null };
    // Don't notify here — the hook will reset its own local state via connected=false branch
}

function _subscribe(listener: Listener): () => void {
    _listeners.add(listener);
    return () => _listeners.delete(listener);
}

// ─── Hook ────────────────────────────────────────────────────

/**
 * Subscribes to the module-level singleton polling manager.
 * Any number of mounted components share a single LibboxCommandClient loop.
 */
export function useProxyNodes(connected: boolean): ProxyNodesState {
    const [localState, setLocalState] = useState<PollState>(() => ({ ..._state }));
    const [localCurrentNode, setLocalCurrentNode] = useState(_state.currentNode);

    useEffect(() => {
        if (!connected) {
            _stopPolling();
            setLocalState({ nodes: [], currentNode: '', isLoading: false, error: null });
            setLocalCurrentNode('');
            return;
        }

        // Sync from shared state immediately (handles re-subscribe mid-session)
        setLocalState({ ..._state });
        setLocalCurrentNode(_state.currentNode);

        // Start (or restart) the singleton loop only when not already running
        if (!_isRunning) {
            _startPolling();
        }

        const unsub = _subscribe(state => {
            setLocalState({ ...state });
            setLocalCurrentNode(state.currentNode);
        });

        return unsub;

    }, [connected]);

    return {
        nodes: localState.nodes,
        currentNode: localCurrentNode,
        isLoading: localState.isLoading,
        error: localState.error,
        setCurrentNode: setLocalCurrentNode,
    };
}
