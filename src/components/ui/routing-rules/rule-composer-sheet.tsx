import { useAccentBlue } from '@/constants/ios26-palette';
import i18n from '@/constants/language';
import { Fonts } from '@/constants/theme';
import {
    FlatRule,
    RULE_ACTIONS,
    RULE_KINDS,
    RuleAction,
    RuleKind,
} from '@/database/custom-rules';
import { useTheme } from '@/hooks/use-theme';
import { parseBulkInput, validateToken } from '@/utils/rule-input';
import {
    BottomSheetBackdrop,
    BottomSheetBackdropProps,
    BottomSheetFooter,
    BottomSheetFooterProps,
    BottomSheetModal,
    BottomSheetScrollView,
    BottomSheetTextInput,
} from '@gorhom/bottom-sheet';
import {
    ForwardedRef,
    forwardRef,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActionBadge, KindChip } from './rule-badges';
import { SegmentedPicker } from './segmented-picker';

// domain + domain_suffix 属于一个可编辑类别，ip_cidr 属于另一个。编辑已有
// 规则时，kind 选择器保持在其原始类别内。
const isDomainClass = (kind: RuleKind) => kind !== 'ip_cidr';

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

export interface RuleComposerSheetProps {
    initial?: FlatRule | null;
    onSubmit: (action: RuleAction, kind: RuleKind, values: string[]) => void;
    onDismiss?: () => void;
}

export const RuleComposerSheet = forwardRef<BottomSheetModal, RuleComposerSheetProps>(
    function RuleComposerSheet(
        { initial, onSubmit, onDismiss }: RuleComposerSheetProps,
        ref: ForwardedRef<BottomSheetModal>,
    ) {
        const theme = useTheme();
        const accentBlue = useAccentBlue();
        const insets = useSafeAreaInsets();
        const snapPoints = useMemo(() => ['90%'], []);

        // 保留一个内部句柄，以便提交后能 dismiss，同时仍把真正的 BottomSheetModal
        // 实例转发给父组件。
        const innerRef = useRef<BottomSheetModal>(null);
        const setRefs = useCallback(
            (node: BottomSheetModal | null) => {
                innerRef.current = node;
                if (typeof ref === 'function') ref(node);
                else if (ref) ref.current = node;
            },
            [ref],
        );

        const isEdit = initial != null;

        const [action, setAction] = useState<RuleAction>('proxy');
        const [kind, setKind] = useState<RuleKind>('domain');
        const [text, setText] = useState('');

        useEffect(() => {
            if (initial) {
                setAction(initial.action);
                setKind(initial.kind);
                setText(initial.value);
            } else {
                setAction('proxy');
                setKind('domain');
                setText('');
            }
        }, [initial]);

        const actionOptions = useMemo(
            () => RULE_ACTIONS.map((a) => ({ value: a, label: i18n.t(`rule_action_${a}`) })),
            [],
        );

        const kindOptions = useMemo(
            () =>
                RULE_KINDS.map((k) => ({
                    value: k,
                    label: i18n.t(`rule_kind_${k}`),
                    disabled: initial != null && isDomainClass(k) !== isDomainClass(initial.kind),
                })),
            [initial],
        );

        const validTokens = useMemo(
            () => parseBulkInput(text).filter((token) => validateToken(kind, token)),
            [text, kind],
        );
        const parsedCount = useMemo(() => parseBulkInput(text).length, [text]);
        const skippedCount = parsedCount - validTokens.length;
        const canSubmit = validTokens.length > 0;

        const handleSubmit = useCallback(() => {
            if (validTokens.length === 0) return;
            onSubmit(action, kind, validTokens);
            setText('');
            innerRef.current?.dismiss();
        }, [action, kind, validTokens, onSubmit]);

        // 把提交按钮固定在键盘 / home indicator 之上，无论滚动到哪里都可点到。
        const renderFooter = useCallback(
            (props: BottomSheetFooterProps) => (
                <BottomSheetFooter {...props} bottomInset={0}>
                    <View
                        style={[
                            styles.footer,
                            {
                                paddingBottom: insets.bottom + 12,
                                backgroundColor: theme.background,
                            },
                        ]}
                    >
                        <Pressable
                            onPress={handleSubmit}
                            disabled={!canSubmit}
                            accessibilityRole="button"
                            accessibilityState={{ disabled: !canSubmit }}
                            style={({ pressed }) => [
                                styles.submit,
                                {
                                    backgroundColor: accentBlue,
                                    opacity: canSubmit ? (pressed ? 0.85 : 1) : 0.4,
                                },
                            ]}
                        >
                            <Text style={[styles.submitText, { fontFamily: Fonts?.rounded }]}>
                                {i18n.t('rule_save')}
                            </Text>
                        </Pressable>
                    </View>
                </BottomSheetFooter>
            ),
            [accentBlue, canSubmit, handleSubmit, insets.bottom, theme.background],
        );

        return (
            <BottomSheetModal
                ref={setRefs}
                snapPoints={snapPoints}
                topInset={insets.top + 8}
                enablePanDownToClose
                keyboardBehavior="interactive"
                keyboardBlurBehavior="restore"
                android_keyboardInputMode="adjustResize"
                onDismiss={onDismiss}
                backdropComponent={renderBackdrop}
                footerComponent={renderFooter}
                backgroundStyle={{ backgroundColor: theme.background }}
                handleIndicatorStyle={{ backgroundColor: `${theme.textSecondary}60` }}
            >
                <View style={styles.header}>
                    <Text style={[styles.headerEyebrow, { color: theme.textSecondary, fontFamily: Fonts?.sans }]}>
                        {i18n.t('section_routing').toUpperCase()}
                    </Text>
                    <Text style={[styles.headerTitle, { color: theme.text, fontFamily: Fonts?.rounded }]}>
                        {i18n.t(isEdit ? 'rule_edit_title' : 'rule_add_title')}
                    </Text>
                </View>

                <BottomSheetScrollView
                    contentContainerStyle={styles.body}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                >
                    <View style={styles.field}>
                        <Text style={[styles.fieldLabel, { color: theme.textSecondary, fontFamily: Fonts?.sans }]}>
                            {i18n.t('rule_field_action')}
                        </Text>
                        <SegmentedPicker options={actionOptions} value={action} onChange={setAction} />
                    </View>

                    <View style={styles.field}>
                        <Text style={[styles.fieldLabel, { color: theme.textSecondary, fontFamily: Fonts?.sans }]}>
                            {i18n.t('rule_field_kind')}
                        </Text>
                        <SegmentedPicker options={kindOptions} value={kind} onChange={setKind} />
                    </View>

                    <View style={styles.field}>
                        <Text style={[styles.fieldLabel, { color: theme.textSecondary, fontFamily: Fonts?.sans }]}>
                            {i18n.t('rule_field_value')}
                        </Text>
                        <BottomSheetTextInput
                            multiline
                            value={text}
                            onChangeText={setText}
                            placeholder={i18n.t(`rule_placeholder_${kind}`)}
                            placeholderTextColor={`${theme.textSecondary}99`}
                            autoCapitalize="none"
                            autoCorrect={false}
                            spellCheck={false}
                            style={[
                                styles.input,
                                {
                                    color: theme.text,
                                    fontFamily: Fonts?.mono,
                                    backgroundColor: `${theme.textSecondary}1F`,
                                },
                            ]}
                        />
                        <Text style={[styles.hint, { color: theme.textSecondary, fontFamily: Fonts?.sans }]}>
                            {i18n.t('rule_bulk_hint')}
                        </Text>
                        {skippedCount > 0 ? (
                            <Text style={[styles.hint, { color: '#FF9500', fontFamily: Fonts?.sans }]}>
                                {i18n.t('rule_invalid_skipped')}
                            </Text>
                        ) : null}
                    </View>

                    <View style={[styles.preview, { backgroundColor: `${theme.textSecondary}0F` }]}>
                        <ActionBadge action={action} small />
                        <KindChip kind={kind} />
                        <Text
                            style={[styles.previewValue, { color: theme.text, fontFamily: Fonts?.mono }]}
                            numberOfLines={1}
                        >
                            {validTokens[0] ?? i18n.t(`rule_placeholder_${kind}`)}
                        </Text>
                        <View style={[styles.countPill, { backgroundColor: `${accentBlue}1A` }]}>
                            <Text style={[styles.countText, { color: accentBlue, fontFamily: Fonts?.mono }]}>
                                {validTokens.length}
                            </Text>
                        </View>
                    </View>

                    <Text style={[styles.priorityHint, { color: theme.textSecondary, fontFamily: Fonts?.sans }]}>
                        {i18n.t('rule_priority_hint')}
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
        paddingBottom: 96,
        gap: 20,
    },
    field: {
        gap: 8,
    },
    fieldLabel: {
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 0.6,
        textTransform: 'uppercase',
    },
    input: {
        minHeight: 88,
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 15,
        lineHeight: 20,
        textAlignVertical: 'top',
    },
    hint: {
        fontSize: 12,
        lineHeight: 16,
        letterSpacing: -0.05,
    },
    preview: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    previewValue: {
        flex: 1,
        fontSize: 13,
    },
    countPill: {
        minWidth: 24,
        borderRadius: 10,
        paddingHorizontal: 8,
        paddingVertical: 2,
        alignItems: 'center',
        justifyContent: 'center',
    },
    countText: {
        fontSize: 13,
        fontWeight: '700',
    },
    priorityHint: {
        fontSize: 12,
        lineHeight: 16,
        letterSpacing: -0.05,
    },
    footer: {
        paddingHorizontal: 20,
        paddingTop: 8,
    },
    submit: {
        height: 50,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
    },
    submitText: {
        color: '#FFFFFF',
        fontSize: 17,
        fontWeight: '700',
        letterSpacing: -0.2,
    },
});
