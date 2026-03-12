import ExpoOneBox from '@/modules/expo-onebox';
import { useEffect, useState } from 'react';

// ─── Constants ───────────────────────────────────────────────

const POLL_INITIAL_DELAY = 500;
/** Time to wait after triggering URLTest before fetching results. */
const URLTEST_WAIT = 2000;
/** Inter-test interval after the rapid phase. */
const POLL_INTERVAL = 5000;


/** Max spinner animation duration (purely visual, no logic). */
const TESTING_SPINNER_DURATION = 3000;

/** Tag of the proxy selector group in the sing-box config. */
export const GATEWAY_GROUP_TAG = 'ExitGateway';
/** Tag of the URLTest auto-select group nested inside ExitGateway. */
const AUTO_GROUP_TAG = 'auto';

// ─── Types ───────────────────────────────────────────────────

export interface NodeItem {
    tag: string;
    delay: number;
    /** true while URLTest is in-flight AND the node had no prior delay (delay===0). */
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

/** Node tags currently showing the URLTest spinner (only delay===0 nodes). */
const testingNodes = new Set<string>();
const testingTimers = new Map<string, ReturnType<typeof setTimeout>>();

function markTesting(tag: string) {
    testingNodes.add(tag);
    const existing = testingTimers.get(tag);
    if (existing) clearTimeout(existing);
    // Pure animation timer — hides the spinner after max duration, no side effects.
    const timer = setTimeout(() => {
        testingNodes.delete(tag);
        testingTimers.delete(tag);
        emitState();
    }, TESTING_SPINNER_DURATION);
    testingTimers.set(tag, timer);
}

function clearTestingTimers() {
    testingTimers.forEach(t => clearTimeout(t));
    testingTimers.clear();
    testingNodes.clear();
}

function clearTestingIfResolved(nodes: { tag: string; delay: number }[]) {
    for (const n of nodes) {
        if (n.delay > 0 && testingNodes.has(n.tag)) {
            testingNodes.delete(n.tag);
            const timer = testingTimers.get(n.tag);
            if (timer) { clearTimeout(timer); testingTimers.delete(n.tag); }
        }
    }
}

// ─── State Emission ───────────────────────────────────────────

function emitState() {
    const emitted: PollState = {
        ...pollState,
        nodes: rawNodes.map(n => ({ ...n, testing: testingNodes.has(n.tag) })),
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

        // Show spinner only for nodes with no prior delay (delay===0)
        let anyMarked = false;
        if (tag === GATEWAY_GROUP_TAG) {
            rawNodes.forEach(n => { if (n.delay === 0) { markTesting(n.tag); anyMarked = true; } });
        } else {
            const node = rawNodes.find(n => n.tag === tag);
            if (node && node.delay === 0) { markTesting(tag); anyMarked = true; }
        }
        if (anyMarked) emitState();

        // Step 1: send URLTest request to sing-box (awaits gRPC ack, ~100ms)
        // Also trigger the nested auto group so its displayed delay reflects the best member.
        try { await ExpoOneBox.triggerURLTest(tag); } catch { }
        if (tag === GATEWAY_GROUP_TAG) {
            try { await ExpoOneBox.triggerURLTest(AUTO_GROUP_TAG); } catch { }
        }
        if (generation !== loopGeneration) break;

        // Step 2: wait for URLTest to run on the sing-box side (non-cancellable)
        await urltestWait(URLTEST_WAIT);
        if (generation !== loopGeneration) break;

        // Step 3: fetch updated delay data (completes this test iteration)
        try {
            const res = await ExpoOneBox.getProxyNodes();
            if (generation !== loopGeneration) break;

            failCount = 0;
            const fetchedNodes = res.all ?? [];
            clearTestingIfResolved(fetchedNodes);
            updatePollState({
                rawNodes: fetchedNodes,
                currentNode: res.now || pollState.currentNode,
                isLoading: false,
                error: null,
            });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (failCount >= 3) updatePollState({ error: msg || '无法获取节点列表', isLoading: false });
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
    updatePollState({ isLoading: true, rawNodes: [], currentNode: '', error: null });
    runProducer(loopGeneration);
}

function stopPolling() {
    loopGeneration++;
    cancelIntervalSleep();
    isRunning = false;
    isPickerOpen = false;
    clearTestingTimers();
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
        nodes: rawNodes.map(n => ({ ...n, testing: false })),
    }));
    const [localCurrentNode, setLocalCurrentNode] = useState(pollState.currentNode);

    useEffect(() => {
        if (!connected) {
            stopPolling();
            setLocalState({ nodes: [], currentNode: '', isLoading: false, error: null });
            setLocalCurrentNode('');
            return;
        }

        setLocalState({ ...pollState, nodes: rawNodes.map(n => ({ ...n, testing: testingNodes.has(n.tag) })) });
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
