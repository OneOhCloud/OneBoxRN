import { selectionChanged } from '@/components/ui/haptics';
import { NodeSignal } from '@/components/ui/home/node-signal';
import { useAccentBlue } from '@/constants/ios26-palette';
import i18n from '@/constants/language';
import { Fonts } from '@/constants/theme';
import { useVpn } from '@/contexts/vpn-context';
import { NodeItem } from '@/hooks/use-proxy-nodes';
import { useTheme } from '@/hooks/use-theme';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

export type { NodeItem } from '@/hooks/use-proxy-nodes';

// 断开后继续显示上一个节点名的时长（毫秒）
const NODE_LABEL_LINGER_MS = 1000;

interface NodeListProps {
    nodes: NodeItem[];
    currentNode: string;
    isLoading: boolean;
    onOpenPicker: () => void;
}

export function NodeList({
    nodes,
    currentNode,
    isLoading,
    onOpenPicker,
}: NodeListProps) {
    const theme = useTheme();
    const accent = useAccentBlue();
    const { connected } = useVpn();

    // 延迟清空节点标签，避免 VPN 一停就瞬间跳到 "—"。上升沿在渲染期调整
    // （guarded setState，即 React 的 "adjusting state when props change"）；
    // 只有下降沿需要 linger 定时器。
    const [displayConnected, setDisplayConnected] = useState(connected);
    if (connected && !displayConnected) {
        setDisplayConnected(true);
    }
    useEffect(() => {
        if (connected) return;
        const timer = setTimeout(() => setDisplayConnected(false), NODE_LABEL_LINGER_MS);
        return () => clearTimeout(timer);
    }, [connected]);

    const openPicker = useCallback(() => {
        if (!connected || nodes.length === 0) return;
        selectionChanged();
        onOpenPicker();
    }, [connected, nodes.length, onOpenPicker]);

    const currentItem = nodes.find(n => n.tag === currentNode);

    // 只有拿到真实数据时才计算实时名称
    const liveName = (() => {
        if (isLoading || !currentItem) return null;
        if (nodes.length === 0) return null;
        if (currentItem.tag === 'auto') return i18n.t('auto');
        return currentItem.tag;
    })();

    // 冻结最后已知的名称，使其在断开后仍保留一会儿——用渲染期调整的 state
    // （React 的 "storing information from previous renders"）而非 ref，
    // 因此渲染过程从不触碰可变单元。
    const [lastName, setLastName] = useState<string | null>(null);
    if (connected && liveName !== null && liveName !== lastName) {
        setLastName(liveName);
    }

    const displayName = (() => {
        if (!displayConnected) return i18n.t('no_expire_info');
        // linger 期间：实时数据消失时显示冻结的名称
        if (liveName !== null) return liveName;
        if (lastName !== null) return lastName;
        if (isLoading) return i18n.t('loading');
        return i18n.t('no_nodes');
    })();

    const interactive = connected && nodes.length > 0;
    // linger 期间即便交互已禁用也显示 caret
    const showCaret = interactive || (displayConnected && lastName !== null);

    return (
        <View>
            <Pressable
                onPress={openPicker}
                disabled={!interactive}
                style={({ pressed }) => [
                    styles.trigger,
                    { opacity: pressed ? 0.6 : 1 },
                ]}
            >
                <View style={styles.left}>
                    <Text
                        style={[
                            styles.eyebrow,
                            { color: theme.textSecondary, fontFamily: Fonts?.sans },
                        ]}
                    >
                        {i18n.t('node_label_connected').toUpperCase()}
                    </Text>
                    <View style={styles.nameRow}>
                        {isLoading && connected && (
                            <ActivityIndicator
                                size="small"
                                color={theme.textSecondary}
                                style={styles.nameSpinner}
                            />
                        )}
                        <Text
                            numberOfLines={1}
                            style={[
                                styles.name,
                                {
                                    color: currentItem ? theme.text : theme.textSecondary,
                                    fontFamily: Fonts?.rounded,
                                },
                            ]}
                        >
                            {displayName}
                        </Text>
                        {showCaret && (
                            <Text
                                style={[
                                    styles.caret,
                                    { color: accent, fontFamily: Fonts?.rounded },
                                ]}
                            >
                                {'›'}
                            </Text>
                        )}
                    </View>
                </View>

                {currentItem && (
                    <NodeSignal
                        delay={currentItem.delay}
                        testing={currentItem.testing}
                        stale={currentItem.stale}
                    />
                )}
            </Pressable>

        </View>
    );
}

const styles = StyleSheet.create({
    trigger: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 4,
        paddingVertical: 4,
        gap: 12,
    },
    left: {
        flex: 1,
        gap: 4,
    },
    eyebrow: {
        fontSize: 9,
        fontWeight: '700',
        letterSpacing: 1.3,
        opacity: 0.7,
    },
    nameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    nameSpinner: {
        marginRight: 2,
    },
    name: {
        flexShrink: 1,
        fontSize: 19,
        fontWeight: '600',
        letterSpacing: -0.4,
    },
    caret: {
        fontSize: 22,
        fontWeight: '400',
        lineHeight: 22,
        opacity: 0.8,
        marginLeft: 2,
    },
});
