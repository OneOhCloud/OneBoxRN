import { ThemedText } from '@/components/themed-text';
import { selectionChanged } from '@/components/ui/haptics';
import { DelayBadge } from '@/components/ui/home/delay-badge';
import { NodePickerSheet } from '@/components/ui/home/node-picker-sheet';
import i18n from '@/constants/language';
import { useVpn } from '@/contexts/vpn-context';
import { useProxyNodes } from '@/hooks/use-proxy-nodes';
import { useTheme } from '@/hooks/use-theme';
import ExpoOneBox from '@/modules/expo-onebox';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheetModal } from '@gorhom/bottom-sheet';
import { useCallback, useRef } from 'react';
import { ActivityIndicator, Alert, Pressable, View } from 'react-native';

export type { NodeItem } from '@/hooks/use-proxy-nodes';

interface NodeListProps {
    bottomPadding?: number;
}

export function NodeList({ bottomPadding = 0 }: NodeListProps) {
    const theme = useTheme();
    const { connected } = useVpn();
    const { nodes, currentNode, isLoading, error, setCurrentNode } = useProxyNodes(connected);
    const sheetRef = useRef<BottomSheetModal>(null);

    const handleSelect = useCallback(async (tag: string) => {
        sheetRef.current?.dismiss();
        selectionChanged();
        try {
            await ExpoOneBox.selectProxyNode(tag);
            setCurrentNode(tag);
        } catch (e: unknown) {
            Alert.alert(i18n.t('node_switch_failed'), e instanceof Error ? e.message : i18n.t('request_failed'));
        }
    }, [setCurrentNode]);

    const openPicker = useCallback(() => {
        if (!connected || nodes.length === 0) return;
        selectionChanged();
        sheetRef.current?.present();
    }, [connected, nodes.length]);

    const currentItem = nodes.find(n => n.tag === currentNode);
    const triggerLabel = () => {
        if (error) return 'error';
        if (!connected) return '';
        if (isLoading) return 'loading...';
        if (nodes.length === 0) return 'no nodes';
        if (!currentItem) return 'select node';
        if (currentItem.tag === 'auto') return i18n.t("auto")
        return currentItem.tag;

    }

    return (
        <View >

            <View className=' mb-4 px-1'>
                <ThemedText type="small" themeColor="textSecondary">
                    {i18n.t('node_label_connected')}
                </ThemedText>
            </View>

            {/* Trigger row */}
            <Pressable
                onPress={openPicker}
                disabled={!connected || nodes.length === 0}
                style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: 16,
                    paddingVertical: 14,
                    borderRadius: 16,
                    backgroundColor: pressed
                        ? `${theme.backgroundElement}CC`
                        : `${theme.backgroundElement}80`,
                })}
            >
                {isLoading && connected
                    ? <ActivityIndicator
                        size="small"
                        color={theme.textSecondary}
                        style={{ marginRight: 10 }}
                    />
                    : <Ionicons
                        name="radio-button-on"
                        size={18}
                        color={connected && currentItem ? '#4A8FCC' : theme.textSecondary}
                        style={{ marginRight: 10 }}
                    />
                }
                <ThemedText
                    style={{ flex: 1, fontWeight: currentItem ? '500' : '400' }}
                    themeColor={currentItem ? 'text' : 'textSecondary'}
                    numberOfLines={1}
                >
                    {triggerLabel()}
                </ThemedText>
                {currentItem && <DelayBadge delay={currentItem.delay} />}
                {connected && nodes.length > 0 && (
                    <Ionicons
                        name="chevron-forward"
                        size={14}
                        color={theme.textSecondary}
                        style={{ marginLeft: 6 }}
                    />
                )}
            </Pressable>

            {/* Bottom sheet picker */}
            <NodePickerSheet
                ref={sheetRef}
                nodes={nodes}
                currentNode={currentNode}
                onSelect={handleSelect}
            />
        </View>
    );
}
