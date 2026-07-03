import { useVpn } from '@/contexts/vpn-context';
import { useProxyNodeState } from '@/contexts/vpn/node-store';
import type { NodeStoreState } from '@/contexts/vpn/node-store-core';
import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';

export { type NodeItem } from '@/contexts/vpn/node-store-core';

// ─── Hook ────────────────────────────────────────────────────
//
// context 持有的 node store 之上的轻量 selector。数据流：
//   1. urltest group 上 sing-box 的 `interval` 配置驱动周期性测试。
//   2. 原生 SubscribeGroups 流把 `onGroupUpdate` 事件推给 VpnContext 内的
//      唯一监听器，由它喂给 node store。
//   3. 本 hook 经 useSyncExternalStore 读取 store，只决定“何时”重置状态 /
//      触发测试（连接、配置切换、前台恢复）—— 它绝不直接触碰 bridge。

export function useProxyNodes(connected: boolean, activeProfileId: string | null): NodeStoreState {
    const { triggerNodeTests, resetNodes } = useVpn();
    const state = useProxyNodeState();
    const appStateRef = useRef<AppStateStatus>(AppState.currentState);

    useEffect(() => {
        // 每次依赖变化时，先清除上一个配置或连接的陈旧数据，再决定接下来
        // 显示什么。这些变更的是 external store，不是 React state。
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

    return state;
}
