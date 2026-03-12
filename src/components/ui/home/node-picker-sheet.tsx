import { ThemedText } from '@/components/themed-text';
import { DelayBadge } from '@/components/ui/home/delay-badge';
import i18n from '@/constants/language';
import { NodeItem } from '@/hooks/use-proxy-nodes';
import { useTheme } from '@/hooks/use-theme';
import { Ionicons } from '@expo/vector-icons';
import {
    BottomSheetBackdrop,
    BottomSheetBackdropProps,
    BottomSheetFlatList,
    BottomSheetModal,
} from '@gorhom/bottom-sheet';
import { ForwardedRef, forwardRef, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ─── SheetItem ───────────────────────────────────────────────

interface SheetItemProps {
    item: NodeItem;
    selected: boolean;
    onSelect: (tag: string) => void;
}

function SheetItem({ item, selected, onSelect }: SheetItemProps) {
    const theme = useTheme();
    return (
        <Pressable
            onPress={() => onSelect(item.tag)}
            style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 20,
                paddingVertical: 14,
                backgroundColor: selected
                    ? `${theme.backgroundSelected}99`
                    : pressed ? `${theme.backgroundSelected}50` : 'transparent',
            })}
        >
            <View style={{ width: 28, alignItems: 'center', marginRight: 4 }}>
                {selected
                    ? <Ionicons name="checkmark-circle" size={20} color="#4A8FCC" />
                    : <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: theme.textSecondary }} />
                }
            </View>
            <ThemedText
                style={{ flex: 1, fontWeight: selected ? '600' : '400', fontSize: 15 }}
                numberOfLines={1}
            >
                {
                    item.tag === 'auto' ? i18n.t("auto") : item.tag
                }
            </ThemedText>
            <DelayBadge delay={item.delay} testing={item.testing} />
        </Pressable>
    );
}

// ─── Separator ───────────────────────────────────────────────

function SheetSeparator() {
    const theme = useTheme();
    return <View style={{ height: StyleSheet.hairlineWidth, marginLeft: 52, backgroundColor: `${theme.textSecondary}25` }} />;
}

// ─── Backdrop ────────────────────────────────────────────────

function renderBackdrop(props: BottomSheetBackdropProps) {
    return <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.4} />;
}

// ─── NodePickerSheet ─────────────────────────────────────────

export interface NodePickerSheetProps {
    nodes: NodeItem[];
    currentNode: string;
    onSelect: (tag: string) => void;
    onDismiss?: () => void;
}

export const NodePickerSheet = forwardRef<BottomSheetModal, NodePickerSheetProps>(
    function NodePickerSheet(
        { nodes, currentNode, onSelect, onDismiss }: NodePickerSheetProps,
        ref: ForwardedRef<BottomSheetModal>
    ) {
        const theme = useTheme();
        const insets = useSafeAreaInsets();
        const snapPoints = useMemo(() => ['50%', '66.7%'], []);
        const topInset = insets.top + 8;

        return (
            <BottomSheetModal
                ref={ref}
                snapPoints={snapPoints}
                topInset={topInset}
                enablePanDownToClose
                onDismiss={onDismiss}
                backdropComponent={renderBackdrop}
                backgroundStyle={{ backgroundColor: theme.background }}
                handleIndicatorStyle={{ backgroundColor: `${theme.textSecondary}60` }}
            >
                <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: `${theme.textSecondary}20` }} />
                <BottomSheetFlatList<NodeItem>
                    data={nodes}
                    keyExtractor={(item: NodeItem) => item.tag}
                    renderItem={({ item }: { item: NodeItem }) => (
                        <SheetItem item={item} selected={item.tag === currentNode} onSelect={onSelect} />
                    )}
                    ItemSeparatorComponent={SheetSeparator}
                    contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
                    showsVerticalScrollIndicator={false}
                />
            </BottomSheetModal>
        );
    }
);
