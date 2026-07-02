import { useVpn } from '@/contexts/vpn-context';
import { useProxyNodeState } from '@/contexts/vpn/node-store';
import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';

export { GATEWAY_GROUP_TAG, type NodeItem } from '@/contexts/vpn/node-store-core';

export interface ProxyNodesState {
    nodes: import('@/contexts/vpn/node-store-core').NodeItem[];
    currentNode: string;
    autoResolvedNode: string | null;
    isLoading: boolean;
    error: string | null;
}

// ─── Hook ────────────────────────────────────────────────────
//
// Thin selector over the context-owned node store. Data flow:
//   1. sing-box's `interval` config on the urltest group drives periodic testing.
//   2. The native SubscribeGroups stream pushes `onGroupUpdate` events to the
//      single listener inside VpnContext, which feeds the node store.
//   3. This hook reads the store via useSyncExternalStore and only decides
//      *when* to reset state / trigger tests (connect, profile change,
//      foreground resume) — it never touches the bridge itself.

export function useProxyNodes(connected: boolean, activeProfileId: string | null): ProxyNodesState {
    const { triggerNodeTests, resetNodes } = useVpn();
    const state = useProxyNodeState();
    const appStateRef = useRef<AppStateStatus>(AppState.currentState);

    useEffect(() => {
        // Clear stale data from the previous profile or connection on every
        // dependency change before deciding what to show next. These mutate
        // the external store, not React state.
        resetNodes();
        if (connected) triggerNodeTests();
    }, [connected, activeProfileId, resetNodes, triggerNodeTests]);

    useEffect(() => {
        if (!connected) return;

        const sub = AppState.addEventListener('change', (nextState) => {
            if (appStateRef.current !== 'active' && nextState === 'active') {
                triggerNodeTests();
            }
            appStateRef.current = nextState;
        });

        return () => sub.remove();
    }, [connected, triggerNodeTests]);

    return { ...state, error: null };
}
