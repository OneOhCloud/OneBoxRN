import ExpoOneBox from '@/modules/expo-onebox';
import { AppState, AppStateStatus } from 'react-native';
import { useCallback, useEffect, useRef, useState } from 'react';

// ─── Constants ───────────────────────────────────────────────

/** Tag of the proxy selector group in the sing-box config. */
export const GATEWAY_GROUP_TAG = 'ExitGateway';
/** Tag of the URLTest auto-select group nested inside ExitGateway. */
const AUTO_GROUP_TAG = 'auto';

/** Initial loading guard to avoid endless spinner when URLTest stalls after resume. */
const INITIAL_LOADING_TIMEOUT_MS = 8000;
/** How long we treat delay=0 as "still testing" after an explicit trigger. */
const TESTING_WINDOW_MS = 12000;

// ─── Types ───────────────────────────────────────────────────

export interface NodeItem {
    tag: string;
    delay: number;
    /** true while waiting for first URLTest results. */
    testing: boolean;
}

export interface ProxyNodesState {
    nodes: NodeItem[];
    currentNode: string;
    autoResolvedNode: string | null;
    isLoading: boolean;
    error: string | null;
    setCurrentNode: (tag: string) => void;
    setPickerOpen: (open: boolean) => void;
}

// ─── Hook ────────────────────────────────────────────────────
//
// Data flow:
//   1. sing-box's `interval` config on the urltest group drives periodic testing.
//   2. The native SubscribeGroups gRPC stream pushes `onGroupUpdate`
//      events whenever group state changes (delays, selection).
//   3. This hook receives events and updates React state.
//   4. On connect/foreground resume, one manual triggerURLTest ensures immediate results.
//   5. When activeProfileId changes, stale nodes from the previous profile are
//      cleared immediately so the UI never shows a mismatched node list.

export function useProxyNodes(connected: boolean, activeProfileId: string | null): ProxyNodesState {
    const [nodes, setNodes] = useState<NodeItem[]>([]);
    const [currentNode, setCurrentNode] = useState('');
    const [autoResolvedNode, setAutoResolvedNode] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const testWindowUntilRef = useRef(0);
    const appStateRef = useRef<AppStateStatus>(AppState.currentState);

    const triggerTests = useCallback(() => {
        const now = Date.now();
        testWindowUntilRef.current = now + TESTING_WINDOW_MS;
        setIsLoading(true);

        // One-shot trigger for immediate results.
        // Subsequent tests are driven by sing-box's internal `interval` config.
        ExpoOneBox.triggerURLTest(GATEWAY_GROUP_TAG).catch(() => { });
        ExpoOneBox.triggerURLTest(AUTO_GROUP_TAG).catch(() => { });

        // Loading timeout guard: recover UI even if native URLTest does not report
        // positive delays after long background/sleep cycles.
        const timeout = setTimeout(() => setIsLoading(false), INITIAL_LOADING_TIMEOUT_MS);
        return () => clearTimeout(timeout);
    }, []);

    useEffect(() => {
        // Clear stale data from the previous profile or connection on every
        // dependency change before deciding what to show next.
        setNodes([]);
        setCurrentNode('');
        setAutoResolvedNode(null);

        if (!connected) {
            setIsLoading(false);
            return;
        }

        const clearLoadingTimeout = triggerTests();

        // Stream: receive group updates pushed by native SubscribeGroups
        const sub = ExpoOneBox.addListener('onGroupUpdate', (event) => {
            const now = Date.now();
            const inTestingWindow = now < testWindowUntilRef.current;
            const hasAnyMeasuredDelay = event.all.some(n => n.delay > 0);

            // delay=0 may also mean timeout/no sample; only show spinner during
            // short testing window after active triggers.
            setNodes(event.all.map(n => ({
                ...n,
                testing: inTestingWindow && n.delay === 0,
            })));
            if (event.now) setCurrentNode(event.now);
            setAutoResolvedNode(event.autoNow || null);

            if (hasAnyMeasuredDelay || !inTestingWindow) {
                setIsLoading(false);
            }
        });

        return () => {
            clearLoadingTimeout();
            sub.remove();
        };
    }, [connected, activeProfileId, triggerTests]);

    useEffect(() => {
        if (!connected) return;

        const sub = AppState.addEventListener('change', (nextState) => {
            if (appStateRef.current !== 'active' && nextState === 'active') {
                triggerTests();
            }
            appStateRef.current = nextState;
        });

        return () => sub.remove();
    }, [connected, triggerTests]);

    return {
        nodes,
        currentNode,
        autoResolvedNode,
        isLoading,
        error: null,
        setCurrentNode,
        setPickerOpen: () => { },
    };
}
