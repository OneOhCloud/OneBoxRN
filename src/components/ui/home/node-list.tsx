import { selectionChanged } from '@/components/ui/haptics';
import { NodeSignal } from '@/components/ui/home/node-signal';
import { useAccentBlue } from '@/constants/ios26-palette';
import i18n from '@/constants/language';
import { Fonts } from '@/constants/theme';
import { useVpn } from '@/contexts/vpn-context';
import { NodeItem } from '@/hooks/use-proxy-nodes';
import { useTheme } from '@/hooks/use-theme';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

export type { NodeItem } from '@/hooks/use-proxy-nodes';

// How long (ms) to keep showing the last node name after disconnection
const NODE_LABEL_LINGER_MS = 1000;

interface NodeListProps {
    nodes: NodeItem[];
    currentNode: string;
    isLoading: boolean;
    error: string | null;
    onOpenPicker: () => void;
}

export function NodeList({
    nodes,
    currentNode,
    isLoading,
    error,
    onOpenPicker,
}: NodeListProps) {
    const theme = useTheme();
    const accent = useAccentBlue();
    const { connected } = useVpn();

    // Delay clearing the node label so it doesn't snap to "—" the instant VPN stops
    const [displayConnected, setDisplayConnected] = useState(connected);
    useEffect(() => {
        if (connected) {
            setDisplayConnected(true);
            return;
        }
        const timer = setTimeout(() => setDisplayConnected(false), NODE_LABEL_LINGER_MS);
        return () => clearTimeout(timer);
    }, [connected]);

    const openPicker = useCallback(() => {
        if (!connected || nodes.length === 0) return;
        selectionChanged();
        onOpenPicker();
    }, [connected, nodes.length, onOpenPicker]);

    const currentItem = nodes.find(n => n.tag === currentNode);

    // Compute the live name only when we have real data
    const liveName = (() => {
        if (error) return null;
        if (isLoading || !currentItem) return null;
        if (nodes.length === 0) return null;
        if (currentItem.tag === 'auto') return i18n.t('auto');
        return currentItem.tag;
    })();

    // Freeze the last known name so it lingers after disconnection
    const lastNameRef = useRef<string | null>(null);
    if (connected && liveName !== null) {
        lastNameRef.current = liveName;
    }

    const displayName = (() => {
        if (error) return i18n.t('request_failed');
        if (!displayConnected) return i18n.t('no_expire_info');
        // During linger period: show frozen name if live data is gone
        if (liveName !== null) return liveName;
        if (lastNameRef.current !== null) return lastNameRef.current;
        if (isLoading) return i18n.t('loading');
        return i18n.t('no_nodes');
    })();

    const interactive = connected && nodes.length > 0;
    // Show caret during linger period even though interaction is disabled
    const showCaret = interactive || (displayConnected && lastNameRef.current !== null);

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
                    <NodeSignal delay={currentItem.delay} testing={currentItem.testing} />
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
