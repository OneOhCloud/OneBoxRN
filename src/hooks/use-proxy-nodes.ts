import { GetProxyNodes } from '@/modules/expo-onebox';
import { useEffect, useState } from 'react';

// ─── Constants ───────────────────────────────────────────────

const POLL_INTERVAL = 2000;
const POLL_INITIAL_DELAY = 500;
const POLL_FAIL_THRESHOLD = 3;

// ─── Types ───────────────────────────────────────────────────

export interface NodeItem {
    tag: string;
    delay: number;
}

export interface ProxyNodesState {
    nodes: NodeItem[];
    currentNode: string;
    isLoading: boolean;
    error: string | null;
    setCurrentNode: (tag: string) => void;
}

// ─── Hook ────────────────────────────────────────────────────

/**
 * Polls the proxy node list while connected.
 * Resets state when disconnected.
 */
export function useProxyNodes(connected: boolean): ProxyNodesState {
    const [nodes, setNodes] = useState<NodeItem[]>([]);
    const [currentNode, setCurrentNode] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!connected) {
            setNodes([]);
            setCurrentNode('');
            setError(null);
            setIsLoading(false);
            return;
        }

        setIsLoading(true);

        let cancelled = false;
        let failCount = 0;
        let intervalId: ReturnType<typeof setInterval> | null = null;

        const poll = async () => {
            try {
                const res = await GetProxyNodes();
                if (!cancelled) {
                    failCount = 0;
                    setNodes(res.all ?? []);
                    setCurrentNode(res.now ?? '');
                    setError(null);
                    setIsLoading(false);
                }
            } catch (e: unknown) {
                if (!cancelled) {
                    failCount += 1;
                    const msg = e instanceof Error ? e.message : String(e);
                    console.warn('[NodePoll] error', failCount, msg);
                    if (failCount >= POLL_FAIL_THRESHOLD) {
                        setError(msg ?? '无法获取节点列表');
                        setIsLoading(false);
                    }
                }
            }
        };

        const timer = setTimeout(() => {
            if (cancelled) return;
            poll();
            intervalId = setInterval(poll, POLL_INTERVAL);
        }, POLL_INITIAL_DELAY);

        return () => {
            cancelled = true;
            clearTimeout(timer);
            if (intervalId !== null) clearInterval(intervalId);
        };
    }, [connected]);

    return { nodes, currentNode, isLoading, error, setCurrentNode };
}
