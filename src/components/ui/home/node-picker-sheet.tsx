import { NodeSignal } from '@/components/ui/home/node-signal';
import { useAccentBlue, useHairlineColor } from '@/constants/ios26-palette';
import i18n from '@/constants/language';
import { Fonts } from '@/constants/theme';
import { NodeItem } from '@/hooks/use-proxy-nodes';
import { useTheme } from '@/hooks/use-theme';
import { Ionicons } from '@expo/vector-icons';
import {
    BottomSheetBackdrop,
    BottomSheetBackdropProps,
    BottomSheetFlatList,
    BottomSheetModal,
} from '@gorhom/bottom-sheet';
import { ForwardedRef, forwardRef, memo, useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface SheetItemProps {
    item: NodeItem;
    index: number;
    selected: boolean;
    autoResolvedNode: string | null;
    onSelect: (tag: string) => void;
}

const SheetItem = memo(function SheetItem({ item, index, selected, autoResolvedNode, onSelect }: SheetItemProps) {
    const theme = useTheme();
    const accent = useAccentBlue();

    const label = item.tag === 'auto'
        ? autoResolvedNode
            ? `${i18n.t('auto')} (${autoResolvedNode})`
            : i18n.t('auto')
        : item.tag;

    return (
        <Pressable
            onPress={() => onSelect(item.tag)}
            style={({ pressed }) => [
                styles.row,
                {
                    backgroundColor: selected
                        ? `${accent}14`
                        : pressed
                            ? `${theme.textSecondary}12`
                            : 'transparent',
                    borderLeftColor: selected ? accent : 'transparent',
                },
            ]}
        >
            <Text
                style={[
                    styles.rowIndex,
                    { color: theme.textSecondary, fontFamily: Fonts?.mono },
                ]}
            >
                {String(index + 1).padStart(2, '0')}
            </Text>

            <Text
                numberOfLines={1}
                style={[
                    styles.rowName,
                    {
                        color: theme.text,
                        fontFamily: Fonts?.rounded,
                        fontWeight: selected ? '700' : '500',
                    },
                ]}
            >
                {label}
            </Text>

            <NodeSignal delay={item.delay} testing={item.testing} stale={item.stale} />
        </Pressable>
    );
});

function RowSeparator() {
    const hairline = useHairlineColor();
    return <View style={[styles.separator, { backgroundColor: hairline }]} />;
}

// ─── Backdrop ────────────────────────────────────────────────

function renderBackdrop(props: BottomSheetBackdropProps) {
    return (
        <BottomSheetBackdrop
            {...props}
            appearsOnIndex={0}
            disappearsOnIndex={-1}
            opacity={0.45}
        />
    );
}

// ─── NodePickerSheet ─────────────────────────────────────────

export type NodePickerSheetHandle = BottomSheetModal;

// Sheet 内容经 @gorhom/portal 渲染进 BottomSheetModalProvider 的 PortalHost，
// 后者在组件树中位于 VpnProvider 之外——useVpn() 等 context hook 在此会抛错。
// 数据必须经 props（或 useProxyNodeState 这类模块级 store）传入，绝不能走
// VpnContext。
export interface NodePickerSheetProps {
    nodes: NodeItem[];
    currentNode: string;
    autoResolvedNode: string | null;
    /** 显式测速窗口是否在途——按钮转圈并禁用，防连点。 */
    sweepActive: boolean;
    onSelect: (tag: string) => void;
    /** 手动触发一轮全量测速（节流在 action 层）。 */
    onTestLatency: () => void;
    onDismiss?: () => void;
}

export const NodePickerSheet = forwardRef<NodePickerSheetHandle, NodePickerSheetProps>(
    function NodePickerSheet(
        { nodes, currentNode, autoResolvedNode, sweepActive, onSelect, onTestLatency, onDismiss }: NodePickerSheetProps,
        ref: ForwardedRef<NodePickerSheetHandle>,
    ) {
        const theme = useTheme();
        const hairline = useHairlineColor();
        const accent = useAccentBlue();
        const insets = useSafeAreaInsets();
        const snapPoints = useMemo(() => ['60%', '85%'], []);
        const topInset = insets.top + 8;
        const currentLabel = useMemo(() => {
            if (nodes.length === 0) return i18n.t('no_nodes');
            const selectedTag = nodes.find(n => n.tag === currentNode)?.tag;
            if (selectedTag === 'auto') {
                return i18n.t('auto');
            }
            return currentNode || i18n.t('auto');
        }, [currentNode, nodes]);

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
                <View style={styles.header}>
                    <View style={styles.headerText}>
                        <Text
                            style={[
                                styles.headerEyebrow,
                                { color: theme.textSecondary, fontFamily: Fonts?.sans },
                            ]}
                        >
                            {i18n.t('node_picker_title').toUpperCase()}
                        </Text>
                        <Text
                            style={[
                                styles.headerTitle,
                                { color: theme.text, fontFamily: Fonts?.rounded },
                            ]}
                        >
                            {currentLabel}
                        </Text>
                    </View>
                    <Pressable
                        onPress={onTestLatency}
                        disabled={sweepActive || nodes.length === 0}
                        style={({ pressed }) => [
                            styles.testButton,
                            {
                                borderColor: `${accent}55`,
                                backgroundColor: pressed ? `${accent}14` : 'transparent',
                                opacity: nodes.length === 0 ? 0.4 : 1,
                            },
                        ]}
                    >
                        {sweepActive ? (
                            <ActivityIndicator size="small" color={accent} />
                        ) : (
                            <Ionicons name="speedometer-outline" size={14} color={accent} />
                        )}
                        <Text
                            style={[
                                styles.testButtonText,
                                { color: accent, fontFamily: Fonts?.rounded },
                            ]}
                        >
                            {i18n.t('latency_test')}
                        </Text>
                    </Pressable>
                    <View
                        style={[
                            styles.count,
                            { borderColor: `${accent}55` },
                        ]}
                    >
                        <Text
                            style={[
                                styles.countText,
                                { color: accent, fontFamily: Fonts?.mono },
                            ]}
                        >
                            {String(nodes.length).padStart(2, '0')}
                        </Text>
                    </View>
                </View>

                <View style={[styles.headerRule, { backgroundColor: hairline }]} />

                <BottomSheetFlatList<NodeItem>
                    data={nodes}
                    keyExtractor={(item: NodeItem) => item.tag}
                    renderItem={({ item, index }: { item: NodeItem; index: number }) => (
                        <SheetItem
                            item={item}
                            index={index}
                            selected={item.tag === currentNode}
                            autoResolvedNode={autoResolvedNode}
                            onSelect={onSelect}
                        />
                    )}
                    ItemSeparatorComponent={RowSeparator}
                    contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
                    showsVerticalScrollIndicator={false}
                />
            </BottomSheetModal>
        );
    },
);

const styles = StyleSheet.create({
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 24,
        paddingTop: 12,
        paddingBottom: 16,
        gap: 12,
    },
    headerText: {
        flex: 1,
        gap: 4,
    },
    headerEyebrow: {
        fontSize: 10,
        fontWeight: '700',
        letterSpacing: 1.4,
        opacity: 0.7,
    },
    headerTitle: {
        fontSize: 22,
        fontWeight: '700',
        letterSpacing: -0.5,
    },
    count: {
        minWidth: 40,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 999,
        borderWidth: 1,
        alignItems: 'center',
    },
    testButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 12,
        paddingVertical: 5,
        borderRadius: 999,
        borderWidth: 1,
    },
    testButtonText: {
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 0.2,
    },
    countText: {
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 0.4,
    },
    headerRule: {
        height: StyleSheet.hairlineWidth,
        marginHorizontal: 20,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 20,
        paddingRight: 24,
        paddingVertical: 14,
        gap: 14,
        borderLeftWidth: 3,
    },
    rowIndex: {
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 0.4,
        opacity: 0.6,
        minWidth: 22,
    },
    rowName: {
        flex: 1,
        fontSize: 15,
        letterSpacing: -0.2,
    },
    separator: {
        height: StyleSheet.hairlineWidth,
        marginLeft: 56,
    },
});
