import { useVpn } from '@/contexts/vpn-context';
import { useProxyNodeState } from '@/contexts/vpn/node-store';
import type { NodeStoreState } from '@/contexts/vpn/node-store-core';
import { VPN_STATUS } from '@/modules/expo-onebox/src/ExpoOneBox.types';
import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';

export { type NodeItem } from '@/contexts/vpn/node-store-core';

// ─── Hook ────────────────────────────────────────────────────
//
// context 持有的 node store 之上的轻量 selector。数据流：
//   1. 原生 SubscribeGroups 流把 `onGroupUpdate` 事件推给 VpnContext 内的
//      唯一监听器，由它喂给 node store。
//   2. 本 hook 经 useSyncExternalStore 读取 store，只决定“何时”重置状态 /
//      触发测试（转入 STARTED、配置切换、前台恢复）—— 它绝不直接触碰 bridge。
//
// 门禁在 STARTED 而非 connected（含 STARTING）：daemon 在 STARTED 之前拒绝
// URLTest，过早触发只会白开一个等不到结果的测试窗口。effect 键在 `started`
// 上，STARTING→STARTED 转换时自动补发首轮测速。

export function useProxyNodes(activeProfileId: string | null): NodeStoreState {
    const { status, triggerNodeTests, resetNodes } = useVpn();
    const state = useProxyNodeState();
    const appStateRef = useRef<AppStateStatus>(AppState.currentState);
    const started = status === VPN_STATUS.STARTED;

    useEffect(() => {
        // 每次依赖变化时，先清除上一个配置或连接的陈旧数据，再决定接下来
        // 显示什么。这些变更的是 external store，不是 React state。
        resetNodes();
        if (started) triggerNodeTests();
    }, [started, activeProfileId, resetNodes, triggerNodeTests]);

    useEffect(() => {
        if (!started) return;

        const sub = AppState.addEventListener('change', (nextState) => {
            if (appStateRef.current !== 'active' && nextState === 'active') {
                triggerNodeTests();
            }
            appStateRef.current = nextState;
        });

        return () => sub.remove();
    }, [started, triggerNodeTests]);

    return state;
}
