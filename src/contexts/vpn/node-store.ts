/**
 * 代理节点 store 的 React 绑定。模块级单例（与 log-sink 环形缓冲一样），
 * 使高频 group 更新只重渲染调用 useProxyNodeState 的组件 —— 绝不触及
 * useVpn 消费方。
 */

import { useSyncExternalStore } from 'react';
import { createNodeStore, type NodeStoreState } from './node-store-core';

export const nodeStore = createNodeStore();

export function useProxyNodeState(): NodeStoreState {
    return useSyncExternalStore(nodeStore.subscribe, nodeStore.getSnapshot, nodeStore.getSnapshot);
}
