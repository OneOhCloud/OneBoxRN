/**
 * React binding for the proxy-node store. Module-level singleton (like
 * the log-sink ring buffer) so high-frequency group updates re-render
 * only components that call useProxyNodeState — never useVpn consumers.
 */

import { useSyncExternalStore } from 'react';
import { createNodeStore, type NodeStoreState } from './node-store-core';

export const nodeStore = createNodeStore();

export function useProxyNodeState(): NodeStoreState {
    return useSyncExternalStore(nodeStore.subscribe, nodeStore.getSnapshot, nodeStore.getSnapshot);
}
