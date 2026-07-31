/**
 * 代理节点状态 store 核心 —— 纯粹、无依赖。
 *
 * 持有节点列表 / 当前节点 / 自动解析节点 / 测试窗口。VpnContext 中唯一的
 * 原生监听器喂给 `applyGroupUpdate`；React 经 `useSyncExternalStore` 读取
 *（见 node-store.ts），沿用 log-sink 模式，使高频 group 更新绝不触发
 * `useVpn` 消费方重渲染。
 */

import type { TimerHandle, TimerHost } from './types.ts';
import { defaultTimers } from './types.ts';

// ─── Constants ───────────────────────────────────────────────

/** sing-box 配置中代理 selector group 的 tag。 */
export const GATEWAY_GROUP_TAG = 'ExitGateway';
/** 嵌套在 ExitGateway 内的 URLTest 自动选择 group 的 tag。 */
export const AUTO_GROUP_TAG = 'auto';

/** 显式触发后，delay=0 被视为“仍在测试”的时长；到期强制收口全部 spinner。 */
export const TESTING_WINDOW_MS = 12_000;
/** 加载保护：避免 URLTest 在 resume 后卡住时出现无尽 spinner。 */
export const INITIAL_LOADING_TIMEOUT_MS = 8_000;
/** 超过该时长未成功探测的数值视为陈旧（= 内核默认 urltest interval 3 min）。 */
export const NODE_TEST_STALE_MS = 180_000;

// ─── Types ───────────────────────────────────────────────────

export interface NodeItem {
    tag: string;
    delay: number;
    /** 等待首批 URLTest 结果期间为 true。 */
    testing: boolean;
    /** 最近一次成功探测的毫秒时间戳；0 = 无样本（与 delay=0 恒等出现）。 */
    lastTestAt: number;
    /**
     * 数值是否已陈旧（在事件应用时刻评估——渲染必须保持纯函数，不得调
     * Date.now）。面板打开会触发新一轮测速，因此实际观感与实时评估一致。
     */
    stale: boolean;
}

export interface NodeStoreState {
    nodes: NodeItem[];
    currentNode: string;
    autoResolvedNode: string | null;
    isLoading: boolean;
    /** 显式测速窗口是否在途（测速按钮的进行中状态）。 */
    isSweeping: boolean;
}

/**
 * `GroupUpdateEventPayload`（src/modules/expo-onebox/src/ExpoOneBox.types.ts）的镜像
 * —— 一份不含原生 import 的本地副本，使该纯核心仍能被 node 的类型剥离测试
 * runner 解析。形状与权威定义一致（三端始终发出 `autoNow`；reducer 把其空
 * 字符串映射为 null）。`urlTestTime` 为最近一次成功探测的 unix 秒，0 = 无样本。
 */
export interface GroupUpdate {
    all: { tag: string; delay: number; urlTestTime: number }[];
    now: string;
    autoNow: string;
}

export const EMPTY_NODE_STATE: NodeStoreState = {
    nodes: [],
    currentNode: '',
    autoResolvedNode: null,
    isLoading: false,
    isSweeping: false,
};

// ─── Pure helpers ────────────────────────────────────────────

/** 数值是否已陈旧到值得在 UI 上降淡提示。无样本（0）不算陈旧——它显示为破折号。 */
export function isNodeTestStale(lastTestAt: number, nowMs: number): boolean {
    return lastTestAt > 0 && nowMs - lastTestAt >= NODE_TEST_STALE_MS;
}

// ─── Reducer ─────────────────────────────────────────────────

/**
 * 把一次原生 group 更新纯函数式地映射到旧状态上：
 *  - delay=0 只在显式测试窗口内算作 “testing”（delay=0 也可能表示超时 /
 *    无样本）；
 *  - `urlTestTime`（unix 秒）换算为 `lastTestAt`（毫秒）；
 *  - 空的 `now` 保留上一次选择；
 *  - `autoNow` 每次都覆盖（'' → null）；
 *  - 一旦有任何实测 delay 到达或窗口结束，loading 即清除；
 *  - `isSweeping` 只在窗口内维持。
 */
export function reduceGroupUpdate(
    prev: NodeStoreState,
    event: GroupUpdate,
    nowMs: number,
    testWindowUntil: number,
): NodeStoreState {
    const inTestingWindow = nowMs < testWindowUntil;
    const hasAnyMeasuredDelay = event.all.some((n) => n.delay > 0);
    return {
        nodes: event.all.map((n) => ({
            tag: n.tag,
            delay: n.delay,
            testing: inTestingWindow && n.delay === 0,
            lastTestAt: n.urlTestTime * 1000,
            stale: isNodeTestStale(n.urlTestTime * 1000, nowMs),
        })),
        currentNode: event.now ? event.now : prev.currentNode,
        autoResolvedNode: event.autoNow || null,
        isLoading: hasAnyMeasuredDelay || !inTestingWindow ? false : prev.isLoading,
        isSweeping: prev.isSweeping && inTestingWindow,
    };
}

// ─── Store ───────────────────────────────────────────────────

export interface NodeStore {
    getSnapshot(): NodeStoreState;
    subscribe(listener: () => void): () => void;
    applyGroupUpdate(event: GroupUpdate): void;
    /** 标记 sweeping+loading，打开 12s 测试窗口，(重新)装载 8s/12s 保护。 */
    beginTestingWindow(): void;
    /** 立即关闭测试窗口并收口所有 spinner（触发 RPC 失败时由 action 层调用）。 */
    cancelTestingWindow(): void;
    /** 原生 selectProxyNode 成功后的乐观选择。 */
    markCurrentNode(tag: string): void;
    /** 清空状态 + 保护 timer（断开 / 配置切换时）。 */
    reset(): void;
}

export function createNodeStore(deps?: {
    now?: () => number;
    timers?: TimerHost;
}): NodeStore {
    const now = deps?.now ?? Date.now;
    const timers = deps?.timers ?? defaultTimers;

    let state = EMPTY_NODE_STATE;
    let testWindowUntil = 0;
    let loadingGuard: TimerHandle | null = null;
    let windowGuard: TimerHandle | null = null;
    const listeners = new Set<() => void>();

    function setState(next: NodeStoreState): void {
        state = next;
        listeners.forEach((listener) => listener());
    }

    function clearGuards(): void {
        if (loadingGuard !== null) {
            timers.clearTimeout(loadingGuard);
            loadingGuard = null;
        }
        if (windowGuard !== null) {
            timers.clearTimeout(windowGuard);
            windowGuard = null;
        }
    }

    /**
     * 关窗并收口：任何 spinner（per-node testing / isLoading / isSweeping）都
     * 不允许在窗口关闭后存活。这是「可用节点永久转圈」的机制性修复——
     * 此前 testing 只能靠下一次 group 事件重算，而失败探测不产生事件。
     */
    function closeWindow(): void {
        clearGuards();
        testWindowUntil = 0;
        const hasSpinner =
            state.isLoading || state.isSweeping || state.nodes.some((n) => n.testing);
        if (!hasSpinner) return;
        setState({
            ...state,
            nodes: state.nodes.map((n) => (n.testing ? { ...n, testing: false } : n)),
            isLoading: false,
            isSweeping: false,
        });
    }

    return {
        getSnapshot: () => state,
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        applyGroupUpdate(event) {
            setState(reduceGroupUpdate(state, event, now(), testWindowUntil));
        },
        beginTestingWindow() {
            testWindowUntil = now() + TESTING_WINDOW_MS;
            clearGuards();
            loadingGuard = timers.setTimeout(() => {
                loadingGuard = null;
                if (state.isLoading) setState({ ...state, isLoading: false });
            }, INITIAL_LOADING_TIMEOUT_MS);
            windowGuard = timers.setTimeout(() => {
                windowGuard = null;
                closeWindow();
            }, TESTING_WINDOW_MS);
            if (!state.isLoading || !state.isSweeping) {
                setState({ ...state, isLoading: true, isSweeping: true });
            }
        },
        cancelTestingWindow() {
            closeWindow();
        },
        markCurrentNode(tag) {
            setState({ ...state, currentNode: tag });
        },
        reset() {
            clearGuards();
            testWindowUntil = 0;
            setState(EMPTY_NODE_STATE);
        },
    };
}
