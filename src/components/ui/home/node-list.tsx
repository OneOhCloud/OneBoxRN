import { ThemedText } from '@/components/themed-text';
import { selectionChanged } from '@/components/ui/haptics';
import { useVpn } from '@/contexts/vpn-context';
import { useTheme } from '@/hooks/use-theme';
import { GetProxyNodes, SelectProxyNode } from '@/modules/expo-onebox';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, View } from 'react-native';

const MONO_FONT = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

// ─── Node Row ───────────────────────────────────────────────

interface NodeRowProps {
    tag: string;
    delay: number;
    selected: boolean;
    onSelect: () => void;
}

function NodeRow({ tag, delay, selected, onSelect }: NodeRowProps) {
    const theme = useTheme();
    const delayLabel = delay === 0 ? '—' : `${delay} ms`;
    const delayColor =
        delay === 0
            ? theme.textSecondary
            : delay < 200
                ? '#34C759'
                : delay < 500
                    ? '#FF9F0A'
                    : '#FF3B30';

    return (
        <Pressable
            onPress={() => { selectionChanged(); onSelect(); }}
            style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 16,
                paddingVertical: 14,
                opacity: pressed ? 0.7 : 1,
            })}
        >
            {/* Radio indicator */}
            <View
                style={{
                    width: 20,
                    height: 20,
                    borderRadius: 10,
                    borderWidth: 2,
                    borderColor: selected ? '#007AFF' : theme.textSecondary,
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginRight: 12,
                }}
            >
                {selected && (
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#007AFF' }} />
                )}
            </View>

            {/* Node tag */}
            <ThemedText style={{ flex: 1, fontWeight: selected ? '600' : '400' }}>{tag}</ThemedText>

            {/* Delay */}
            <ThemedText style={{ fontSize: 12, fontWeight: '500', color: delayColor, fontFamily: MONO_FONT }}>
                {delayLabel}
            </ThemedText>
        </Pressable>
    );
}

// ─── Node Separator ─────────────────────────────────────────

function NodeSeparator() {
    const theme = useTheme();
    return <View style={{ height: 0.5, marginLeft: 48, backgroundColor: theme.backgroundElement }} />;
}

// ─── Node List ───────────────────────────────────────────────

export interface NodeItem {
    tag: string;
    delay: number;
}

interface NodeListProps {
    bottomPadding?: number;
}

/** Scrollable list of proxy nodes — self-fetches when connected */
export function NodeList({ bottomPadding = 0 }: NodeListProps) {
    const theme = useTheme();
    const { connected } = useVpn();

    const [nodes, setNodes] = useState<NodeItem[]>([]);
    const [currentNode, setCurrentNode] = useState('');
    const [nodeError, setNodeError] = useState<string | null>(null);

    // ── Polling ──────────────────────────────────────────────
    useEffect(() => {
        if (!connected) {
            setNodes([]);
            setCurrentNode('');
            setNodeError(null);
            return;
        }

        let cancelled = false;
        let failCount = 0;
        let intervalId: ReturnType<typeof setInterval> | null = null;

        const fetchNodes = async () => {
            try {
                const res = await GetProxyNodes();
                if (!cancelled) {
                    failCount = 0;
                    setNodes(res.all ?? []);
                    setCurrentNode(res.now ?? '');
                    setNodeError(null);
                }
            } catch (e: unknown) {
                if (!cancelled) {
                    failCount += 1;
                    const msg = e instanceof Error ? e.message : String(e);
                    console.warn('[NodePoll] error', failCount, msg);
                    if (failCount >= 3) setNodeError(msg ?? '无法获取节点列表');
                }
            }
        };

        const startTimer = setTimeout(() => {
            if (cancelled) return;
            fetchNodes();
            intervalId = setInterval(fetchNodes, 2000);
        }, 2000);

        return () => {
            cancelled = true;
            clearTimeout(startTimer);
            if (intervalId !== null) clearInterval(intervalId);
        };
    }, [connected]);

    // ── Node select ──────────────────────────────────────────
    const handleSelect = useCallback(async (tag: string) => {
        try {
            await SelectProxyNode(tag);
            setCurrentNode(tag);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : '请求失败';
            Alert.alert('切换节点失败', msg);
        }
    }, []);

    return (
        <>
            {/* Section header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8, paddingHorizontal: 4, gap: 8 }}>
                <ThemedText type="small" themeColor="textSecondary">
                    {connected ? '节点选择' : '节点（连接后可选）'}
                </ThemedText>
                {nodes.length > 0 && (
                    <View
                        style={{
                            borderRadius: 8,
                            paddingHorizontal: 8,
                            paddingVertical: 2,
                            backgroundColor: theme.backgroundElement,
                        }}
                    >
                        <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 11 }}>
                            {nodes.length}
                        </ThemedText>
                    </View>
                )}
            </View>

            {/* List */}
            <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingBottom: bottomPadding }}
                showsVerticalScrollIndicator={false}
            >
                {nodes.length === 0 ? (
                    <View style={{ paddingVertical: 32, alignItems: 'center' }}>
                        <ThemedText type="small" themeColor="textSecondary">
                            {nodeError ? `⚠  ${nodeError}` : connected ? '加载中…' : '暂无节点'}
                        </ThemedText>
                    </View>
                ) : (
                    <View
                        style={{
                            borderRadius: 16,
                            overflow: 'hidden',
                            backgroundColor: theme.backgroundElement,
                        }}
                    >
                        {nodes.map((node, index) => (
                            <View key={node.tag}>
                                {index > 0 && <NodeSeparator />}
                                <NodeRow
                                    tag={node.tag}
                                    delay={node.delay}
                                    selected={currentNode === node.tag}
                                    onSelect={() => handleSelect(node.tag)}
                                />
                            </View>
                        ))}
                    </View>
                )}
            </ScrollView>
        </>
    );
}
