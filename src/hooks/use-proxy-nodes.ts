import ExpoOneBox from '@/modules/expo-onebox';
import { useEffect, useState } from 'react';

// ─── Constants ───────────────────────────────────────────────

/** Tag of the proxy selector group in the sing-box config. */
export const GATEWAY_GROUP_TAG = 'ExitGateway';
/** Tag of the URLTest auto-select group nested inside ExitGateway. */
const AUTO_GROUP_TAG = 'auto';
/** Interval between URLTest triggers (ms). */
const URLTEST_INTERVAL = 10000;

// ─── Types ───────────────────────────────────────────────────

export interface NodeItem {
    tag: string;
    delay: number;
    /** Kept for API compatibility; always false with stream-based updates. */
    testing: boolean;
}

export interface ProxyNodesState {
    nodes: NodeItem[];
    currentNode: string;
    isLoading: boolean;
    error: string | null;
    setCurrentNode: (tag: string) => void;
    setPickerOpen: (open: boolean) => void;
}

// ─── Hook ────────────────────────────────────────────────────
//
// Data flow:
//   1. A setInterval triggers URLTest every 5s (fire-and-forget).
//   2. sing-box runs the test internally and updates delay values.
//   3. The native SubscribeGroups gRPC stream pushes `onGroupUpdate`
//      events whenever group state changes (delays, selection).
//   4. This hook receives events and updates React state.
//
// Trigger and delivery are decoupled — no polling, no waiting for results.

export function useProxyNodes(connected: boolean): ProxyNodesState {
    const [nodes, setNodes] = useState<NodeItem[]>([]);
    const [currentNode, setCurrentNode] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (!connected) {
            setNodes([]);
            setCurrentNode('');
            setIsLoading(false);
            return;
        }

        setIsLoading(true);

        // Stream: receive group updates pushed by native SubscribeGroups
        const sub = ExpoOneBox.addListener('onGroupUpdate', (event) => {
            // delay=0 means not yet tested or timed out — show spinner instead of "—"
            setNodes(event.all.map(n => ({ ...n, testing: n.delay === 0 })));
            if (event.now) setCurrentNode(event.now);
            if (event.all.some(n => n.delay > 0)) setIsLoading(false);
        });

        // Trigger: periodically ask sing-box to run URLTest (fire-and-forget).
        // Results arrive via the stream above, not from this call's return value.
        const trigger = () => {
            ExpoOneBox.triggerURLTest(GATEWAY_GROUP_TAG).catch(() => { });
            ExpoOneBox.triggerURLTest(AUTO_GROUP_TAG).catch(() => { });
        };
        trigger(); // immediate first test
        const timer = setInterval(trigger, URLTEST_INTERVAL);

        return () => {
            sub.remove();
            clearInterval(timer);
        };
    }, [connected]);

    return {
        nodes,
        currentNode,
        isLoading,
        error: null,
        setCurrentNode,
        setPickerOpen: () => { },
    };
}
