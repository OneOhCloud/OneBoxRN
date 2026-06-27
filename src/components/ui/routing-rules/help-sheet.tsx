import i18n from '@/constants/language';
import { Fonts } from '@/constants/theme';
import { RULE_ACTIONS, RULE_KINDS } from '@/database/custom-rules';
import { useTheme } from '@/hooks/use-theme';
import {
    BottomSheetBackdrop,
    BottomSheetBackdropProps,
    BottomSheetModal,
    BottomSheetScrollView,
} from '@gorhom/bottom-sheet';
import { ForwardedRef, forwardRef, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActionBadge, KindChip } from './rule-badges';

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

export const HelpSheet = forwardRef<BottomSheetModal, { onDismiss?: () => void }>(
    function HelpSheet(
        { onDismiss }: { onDismiss?: () => void },
        ref: ForwardedRef<BottomSheetModal>,
    ) {
        const theme = useTheme();
        const insets = useSafeAreaInsets();
        const snapPoints = useMemo(() => ['82%'], []);

        return (
            <BottomSheetModal
                ref={ref}
                snapPoints={snapPoints}
                topInset={insets.top + 8}
                enablePanDownToClose
                onDismiss={onDismiss}
                backdropComponent={renderBackdrop}
                backgroundStyle={{ backgroundColor: theme.background }}
                handleIndicatorStyle={{ backgroundColor: `${theme.textSecondary}60` }}
            >
                <View style={styles.header}>
                    <Text style={[styles.headerEyebrow, { color: theme.textSecondary, fontFamily: Fonts?.sans }]}>
                        {i18n.t('section_routing').toUpperCase()}
                    </Text>
                    <Text style={[styles.headerTitle, { color: theme.text, fontFamily: Fonts?.rounded }]}>
                        {i18n.t('rule_help_title')}
                    </Text>
                </View>

                <BottomSheetScrollView
                    contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}
                    showsVerticalScrollIndicator={false}
                >
                    <Text style={[styles.sectionTitle, { color: theme.textSecondary, fontFamily: Fonts?.sans }]}>
                        {i18n.t('rule_field_action')}
                    </Text>
                    <View style={[styles.card, { backgroundColor: theme.cardBackground }]}>
                        {RULE_ACTIONS.map((a) => (
                            <View key={a} style={styles.itemRow}>
                                <ActionBadge action={a} small />
                                <Text
                                    style={[styles.itemDesc, { color: theme.text, fontFamily: Fonts?.sans }]}
                                >
                                    {i18n.t(`rule_action_${a}_desc`)}
                                </Text>
                            </View>
                        ))}
                    </View>

                    <Text style={[styles.sectionTitle, { color: theme.textSecondary, fontFamily: Fonts?.sans }]}>
                        {i18n.t('rule_help_match_title')}
                    </Text>
                    <View style={[styles.card, { backgroundColor: theme.cardBackground }]}>
                        {RULE_KINDS.map((k) => (
                            <View key={k} style={styles.itemRow}>
                                <KindChip kind={k} />
                                <View style={styles.itemText}>
                                    <Text
                                        style={[styles.itemName, { color: theme.text, fontFamily: Fonts?.sans }]}
                                    >
                                        {i18n.t(`rule_kind_${k}`)}
                                    </Text>
                                    <Text
                                        style={[styles.itemExample, { color: theme.textSecondary, fontFamily: Fonts?.mono }]}
                                    >
                                        {i18n.t(`rule_placeholder_${k}`)}
                                    </Text>
                                </View>
                            </View>
                        ))}
                    </View>

                    <Text style={[styles.sectionTitle, { color: theme.textSecondary, fontFamily: Fonts?.sans }]}>
                        {i18n.t('rule_help_priority_title')}
                    </Text>
                    <Text style={[styles.bodyText, { color: theme.text, fontFamily: Fonts?.sans }]}>
                        {i18n.t('rule_priority_hint')}
                    </Text>

                    <Text style={[styles.footnote, { color: theme.textSecondary, fontFamily: Fonts?.sans }]}>
                        {i18n.t('rule_restart_note')}
                    </Text>
                </BottomSheetScrollView>
            </BottomSheetModal>
        );
    },
);

const styles = StyleSheet.create({
    header: {
        paddingHorizontal: 24,
        paddingTop: 8,
        paddingBottom: 14,
        gap: 6,
    },
    headerEyebrow: {
        fontSize: 10,
        fontWeight: '700',
        letterSpacing: 1.4,
        opacity: 0.7,
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: '700',
        letterSpacing: -0.4,
    },
    body: {
        paddingHorizontal: 20,
        paddingTop: 12,
        gap: 10,
    },
    sectionTitle: {
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 0.6,
        textTransform: 'uppercase',
        marginTop: 8,
    },
    card: {
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 6,
        gap: 4,
    },
    itemRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 8,
    },
    itemText: {
        flex: 1,
        gap: 2,
    },
    itemName: {
        fontSize: 15,
        fontWeight: '600',
        letterSpacing: -0.2,
    },
    itemExample: {
        fontSize: 12,
        letterSpacing: -0.05,
    },
    itemDesc: {
        flex: 1,
        fontSize: 14,
        lineHeight: 19,
        letterSpacing: -0.1,
    },
    bodyText: {
        fontSize: 14,
        lineHeight: 19,
        letterSpacing: -0.1,
    },
    footnote: {
        fontSize: 12,
        lineHeight: 16,
        letterSpacing: -0.05,
        marginTop: 8,
    },
});
