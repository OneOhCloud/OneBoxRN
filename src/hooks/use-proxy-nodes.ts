import ExpoOneBox from '@/modules/expo-onebox';
import { useEffect, useState } from 'react';

// ─── Constants ───────────────────────────────────────────────

const POLL_INITIAL_DELAY = 500;
/** Time to wait after triggering URLTest before fetching results. */
const URLTEST_WAIT = 2000;
/** Inter-test interval after the rapid phase. */
const POLL_INTERVAL = 5000;

/** Tag of the proxy selector group in the sing-box config. */
export const GATEWAY_GROUP_TAG = 'ExitGateway';
/** Tag of the URLTest auto-select group nested inside ExitGateway. */
const AUTO_GROUP_TAG = 'auto';

// ─── Types ───────────────────────────────────────────────────

export interface NodeItem {
    tag: string;
    delay: number;
    /** true while URLTest is in-flight. */
    testing: boolean;
}

export interface ProxyNodesState {
    nodes: NodeItem[];
    currentNode: string;
    isLoading: boolean;
    error: string | null;
    setCurrentNode: (tag: string) => void;
    /** Notify the producer when the node picker sheet opens or closes. */
    setPickerOpen: (open: boolean) => void;
}

// ─── Singleton Producer ───────────────────────────────────────
//
// One module-level sequential URLTest loop feeds all hook instances.
// Acts as a data producer: trigger → wait → fetch → emit → interval → repeat.
// Only one native connection exists at a time; each step awaits completion.

interface PollState {
    nodes: NodeItem[];
    currentNode: string;
    isLoading: boolean;
    error: string | null;
}

/** Internal state — `nodes` is always derived from rawNodes, not stored here. */
interface InternalState {
    currentNode: string;
    isLoading: boolean;
    error: string | null;
}

type Listener = (state: PollState) => void;

let rawNodes: { tag: string; delay: number }[] = [];
let pollState: InternalState = { currentNode: '', isLoading: false, error: null };
const listeners = new Set<Listener>();

let loopGeneration = 0;
let intervalSleepTimer: ReturnType<typeof setTimeout> | null = null;
let isRunning = false;
let isPickerOpen = false;

// ─── Testing State ────────────────────────────────────────────

/** true while URLTest is in-flight; drives the spinner on all nodes. */
let isTesting = false;

// ─── State Emission ───────────────────────────────────────────

function emitState() {
    const emitted: PollState = {
        ...pollState,
        nodes: rawNodes.map(n => ({ ...n, testing: isTesting })),
    };
    listeners.forEach(fn => fn(emitted));
}

function updatePollState(patch: Partial<InternalState> & { rawNodes?: { tag: string; delay: number }[] }) {
    if (patch.rawNodes !== undefined) rawNodes = patch.rawNodes;
    const { rawNodes: _, ...rest } = patch;
    pollState = { ...pollState, ...rest };
    emitState();
}

// ─── Picker State ─────────────────────────────────────────────

function setPickerOpen(open: boolean) {
    if (isPickerOpen === open) return;
    isPickerOpen = open;
    // When picker opens, cancel the inter-test sleep so the producer
    // immediately starts testing all nodes without waiting for the interval.
    if (open) cancelIntervalSleep();
}

// ─── Producer Internals ───────────────────────────────────────

/** Cancel the inter-test interval sleep (called when picker opens). */
function cancelIntervalSleep() {
    if (intervalSleepTimer !== null) {
        clearTimeout(intervalSleepTimer);
        intervalSleepTimer = null;
    }
}

/**
 * Cancellable sleep used for inter-test intervals.
 * Can be interrupted by setPickerOpen(true).
 */
function intervalSleep(ms: number): Promise<void> {
    return new Promise(resolve => {
        intervalSleepTimer = setTimeout(() => {
            intervalSleepTimer = null;
            resolve();
        }, ms);
    });
}

/**
 * Non-cancellable sleep used to wait for URLTest to complete on sing-box side.
 * Should not be interrupted mid-test.
 */
function urltestWait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runProducer(generation: number) {
    isRunning = true;
    let failCount = 0;

    // Initial data fetch — populate UI before the first test begins
    await urltestWait(POLL_INITIAL_DELAY);
    if (generation !== loopGeneration) { isRunning = false; return; }

    try {
        const res = await ExpoOneBox.getProxyNodes();
        console.log('[ProxyNodes] initial fetch', res);
        if (generation !== loopGeneration) { isRunning = false; return; }
        updatePollState({ rawNodes: res.all ?? [], currentNode: res.now ?? '', isLoading: false, error: null });
    } catch { }

    // Sequential producer: each iteration completes fully before the next begins.
    while (generation === loopGeneration) {
        const tag = isPickerOpen ? GATEWAY_GROUP_TAG : (pollState.currentNode || '');

        if (!tag) {
            await urltestWait(500); // wait for currentNode to become available
            continue;
        }

        // Step 1: send URLTest request to sing-box (awaits gRPC ack, ~100ms)
        // Also trigger the nested auto group so its displayed delay reflects the best member.
        isTesting = true;
        emitState();
        try { await ExpoOneBox.triggerURLTest(tag); } catch { }
        if (tag === GATEWAY_GROUP_TAG) {
            try { await ExpoOneBox.triggerURLTest(AUTO_GROUP_TAG); } catch { }
        }
        if (generation !== loopGeneration) break;

        // Step 2: wait for URLTest to run on the sing-box side (non-cancellable)
        await urltestWait(URLTEST_WAIT);
        if (generation !== loopGeneration) break;

        // Step 3: fetch updated delay data from getProxyNodes (includes all delays)
        try {
            const res = await ExpoOneBox.getProxyNodes();
            console.log('[ProxyNodes] fetched after URLTest', res);
            if (generation !== loopGeneration) break;

            failCount = 0;
            isTesting = false;
            updatePollState({
                rawNodes: res.all ?? [],
                currentNode: res.now || pollState.currentNode,
                isLoading: false,
                error: null,
            });
        } catch (e) {
            isTesting = false;
            const msg = e instanceof Error ? e.message : String(e);
            if (failCount >= 3) updatePollState({ error: msg || '无法获取节点列表', isLoading: false });
            else emitState();
        }

        if (generation !== loopGeneration) break;

        await intervalSleep(POLL_INTERVAL);
    }

    if (generation === loopGeneration) isRunning = false;
}

function startPolling() {
    loopGeneration++;
    cancelIntervalSleep();
    isPickerOpen = false;
    isTesting = false;
    updatePollState({ isLoading: true, rawNodes: [], currentNode: '', error: null });
    runProducer(loopGeneration);
}

function stopPolling() {
    loopGeneration++;
    cancelIntervalSleep();
    isRunning = false;
    isPickerOpen = false;
    isTesting = false;
    rawNodes = [];
    pollState = { currentNode: '', isLoading: false, error: null };
}

function subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

// ─── Hook ────────────────────────────────────────────────────

export function useProxyNodes(connected: boolean): ProxyNodesState {
    const [localState, setLocalState] = useState<PollState>(() => ({
        ...pollState,
        nodes: rawNodes.map(n => ({ ...n, testing: isTesting })),
    }));
    const [localCurrentNode, setLocalCurrentNode] = useState(pollState.currentNode);

    useEffect(() => {
        if (!connected) {
            stopPolling();
            setLocalState({ nodes: [], currentNode: '', isLoading: false, error: null });
            setLocalCurrentNode('');
            return;
        }

        setLocalState({ ...pollState, nodes: rawNodes.map(n => ({ ...n, testing: isTesting })) });
        setLocalCurrentNode(pollState.currentNode);

        if (!isRunning) startPolling();

        return subscribe(emitted => {
            setLocalState({ ...emitted });
            setLocalCurrentNode(emitted.currentNode);
        });
    }, [connected]);

    return {
        nodes: localState.nodes,
        currentNode: localCurrentNode,
        isLoading: localState.isLoading,
        error: localState.error,
        setCurrentNode: setLocalCurrentNode,
        setPickerOpen,
    };
}
