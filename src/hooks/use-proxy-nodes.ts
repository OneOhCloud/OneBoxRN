import ExpoOneBox from '@/modules/expo-onebox';
import { useEffect, useState } from 'react';

// ─── Constants ───────────────────────────────────────────────

/** Tag of the proxy selector group in the sing-box config. */
export const GATEWAY_GROUP_TAG = 'ExitGateway';
/** Tag of the URLTest auto-select group nested inside ExitGateway. */
const AUTO_GROUP_TAG = 'auto';

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
//   4. On connect, one manual triggerURLTest ensures immediate first results.

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

        // One-shot trigger on connect for immediate results.
        // Subsequent tests are driven by sing-box's internal `interval` config.
        ExpoOneBox.triggerURLTest(GATEWAY_GROUP_TAG).catch(() => { });
        ExpoOneBox.triggerURLTest(AUTO_GROUP_TAG).catch(() => { });

        return () => {
            sub.remove();
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
