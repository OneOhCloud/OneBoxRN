/**
 * 路由规则 — 用户自定义的 (action, kind, value) 匹配器。
 *
 * 每个 action（reject / direct / proxy）对应一个 RuleSet，从 KV store 加载，
 * 展开 + 排序后展示，并通过共享的 bottom sheet composer 编辑。任何改动都经
 * setCustomRuleSet 持久化，随后请求隧道用新配置重启（隧道关闭时 requestRestart
 * 空操作）。本屏从不直接触碰原生模块。
 */
import { SectionAction } from '@/components/ui/ios26/section';
import { HelpSheet } from '@/components/ui/routing-rules/help-sheet';
import { RuleComposerSheet } from '@/components/ui/routing-rules/rule-composer-sheet';
import { RuleRow } from '@/components/ui/routing-rules/rule-row';
import { useAccentBlue } from '@/constants/ios26-palette';
import i18n from '@/constants/language';
import { Fonts, Spacing } from '@/constants/theme';
import {
    emptyRuleSet,
    filterFlatRules,
    flattenRuleSets,
    sortFlatRules,
    type FlatRule,
    type RuleAction,
    type RuleKind,
    type RuleSet,
} from '@/database/custom-rules';
import { getAllCustomRuleSets, setCustomRuleSet } from '@/database/store';
import { useTheme } from '@/hooks/use-theme';
import { useVpn } from '@/contexts/vpn-context';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheetModal } from '@gorhom/bottom-sheet';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    FlatList,
    Platform,
    Pressable,
    Text,
    TextInput,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// 规则从三个 action 集合展开而来，因此仅当列表长到值得逐条浏览时才开启搜索。
const SEARCH_THRESHOLD = 12;

function makeEmptySets(): Record<RuleAction, RuleSet> {
    return { reject: emptyRuleSet(), direct: emptyRuleSet(), proxy: emptyRuleSet() };
}

/** 替换 RuleSet 中某个 kind 的值，其余 kind 保持不变。 */
function withKind(set: RuleSet, kind: RuleKind, values: string[]): RuleSet {
    return { ...set, [kind]: values };
}

function NavBar({
    onBack,
    right,
}: {
    onBack: () => void;
    right?: React.ReactNode;
}) {
    const accentBlue = useAccentBlue();
    return (
        <View style={{ height: 44, justifyContent: 'center' }} pointerEvents="box-none">
            <Pressable
                onPress={onBack}
                accessibilityRole="button"
                accessibilityLabel={i18n.t('back')}
                hitSlop={{ top: 12, bottom: 12, left: 16, right: 24 }}
                style={({ pressed }) => ({
                    position: 'absolute',
                    left: 8,
                    top: 0,
                    bottom: 0,
                    paddingLeft: 8,
                    paddingRight: 8,
                    flexDirection: 'row',
                    alignItems: 'center',
                    opacity: pressed ? 0.4 : 1,
                })}
            >
                <Ionicons name="chevron-back" size={22} color={accentBlue} />
                <Text style={{ color: accentBlue, fontSize: 17, fontWeight: '400', marginLeft: 2 }}>
                    {i18n.t('back')}
                </Text>
            </Pressable>

            {right ? (
                <View
                    style={{
                        position: 'absolute',
                        right: 8,
                        top: 0,
                        bottom: 0,
                        justifyContent: 'center',
                    }}
                >
                    {right}
                </View>
            ) : null}
        </View>
    );
}

export default function RoutingRulesScreen() {
    const theme = useTheme();
    const accentBlue = useAccentBlue();
    const safeAreaInsets = useSafeAreaInsets();
    const { requestRestart } = useVpn();

    const [sets, setSets] = useState<Record<RuleAction, RuleSet>>(makeEmptySets);
    const [query, setQuery] = useState('');
    const [editing, setEditing] = useState<FlatRule | null>(null);

    const composerRef = useRef<BottomSheetModal>(null);
    const helpRef = useRef<BottomSheetModal>(null);

    useEffect(() => {
        let cancelled = false;
        getAllCustomRuleSets()
            .then((loaded) => {
                if (!cancelled) setSets(loaded);
            })
            .catch((e) => console.warn('[RoutingRules] failed to load rule sets:', e));
        return () => {
            cancelled = true;
        };
    }, []);

    const flat = useMemo(() => sortFlatRules(flattenRuleSets(sets)), [sets]);
    const shown = useMemo(() => filterFlatRules(flat, query), [flat, query]);
    const showSearch = flat.length >= SEARCH_THRESHOLD;

    const presentAdd = useCallback(() => {
        setEditing(null);
        composerRef.current?.present();
    }, []);

    const presentEdit = useCallback((rule: FlatRule) => {
        setEditing(rule);
        composerRef.current?.present();
    }, []);

    const presentHelp = useCallback(() => {
        helpRef.current?.present();
    }, []);

    const handleSubmit = useCallback(
        (action: RuleAction, kind: RuleKind, values: string[]) => {
            const next = makeEmptySets();
            next.reject = { ...sets.reject };
            next.direct = { ...sets.direct };
            next.proxy = { ...sets.proxy };

            // 一次编辑可能把规则跨 action/kind 移动，所以先从原集合删掉旧值，
            // 再合并进目标集合。
            if (editing) {
                next[editing.action] = withKind(
                    next[editing.action],
                    editing.kind,
                    next[editing.action][editing.kind].filter((v) => v !== editing.value),
                );
            }

            const merged = Array.from(new Set([...next[action][kind], ...values]));
            next[action] = withKind(next[action], kind, merged);

            void setCustomRuleSet(action, next[action]);
            if (editing && editing.action !== action) {
                void setCustomRuleSet(editing.action, next[editing.action]);
            }

            setSets(next);
            setEditing(null);
            requestRestart();
            composerRef.current?.dismiss();
        },
        [sets, editing, requestRestart],
    );

    const handleDelete = useCallback(
        (rule: FlatRule) => {
            Alert.alert(i18n.t('rule_delete_confirm'), undefined, [
                { text: i18n.t('cancel'), style: 'cancel' },
                {
                    text: i18n.t('rule_delete'),
                    style: 'destructive',
                    onPress: () => {
                        const updated = withKind(
                            sets[rule.action],
                            rule.kind,
                            sets[rule.action][rule.kind].filter((v) => v !== rule.value),
                        );
                        void setCustomRuleSet(rule.action, updated);
                        setSets((prev) => ({ ...prev, [rule.action]: updated }));
                        requestRestart();
                    },
                },
            ]);
        },
        [sets, requestRestart],
    );

    const renderRule = useCallback(({ item }: { item: FlatRule }) => (
        <View
            style={{
                marginHorizontal: 16,
                marginBottom: 8,
                borderRadius: 14,
                overflow: 'hidden',
                backgroundColor: theme.cardBackground,
                paddingVertical: 2,
                ...Platform.select({
                    ios: {
                        shadowColor: '#000',
                        shadowOffset: { width: 0, height: 1 },
                        shadowOpacity: 0.04,
                        shadowRadius: 3,
                    },
                    default: {},
                }),
            }}
        >
            <RuleRow
                rule={item}
                onEdit={() => presentEdit(item)}
                onDelete={() => handleDelete(item)}
            />
        </View>
    ), [theme.cardBackground, presentEdit, handleDelete]);

    return (
        <View
            style={{
                flex: 1,
                backgroundColor: theme.background,
                paddingTop: safeAreaInsets.top || Spacing.six,
                paddingBottom: safeAreaInsets.bottom + Spacing.three,
                paddingLeft: safeAreaInsets.left,
                paddingRight: safeAreaInsets.right,
            }}
        >
            <NavBar
                onBack={() => router.back()}
                right={
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <SectionAction
                            label={i18n.t('rule_add')}
                            onPress={presentAdd}
                            accessibilityLabel={i18n.t('rule_add_title')}
                        />
                        <Pressable
                            onPress={presentHelp}
                            accessibilityRole="button"
                            accessibilityLabel={i18n.t('rule_help_title')}
                            hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
                            style={({ pressed }) => ({ opacity: pressed ? 0.4 : 1, paddingHorizontal: 2 })}
                        >
                            <Ionicons name="help-circle-outline" size={24} color={accentBlue} />
                        </Pressable>
                    </View>
                }
            />

            <FlatList
                data={shown}
                keyExtractor={(rule) => `${rule.action}:${rule.kind}:${rule.value}`}
                renderItem={renderRule}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: Spacing.six }}
                keyboardShouldPersistTaps="handled"
                // Header 是 JSX 元素而非内联组件：内联组件每次按键都会得到新的
                // 类型标识，从而重挂载搜索 TextInput，导致输入时丢失焦点。
                ListHeaderComponent={
                    <>
                <View style={{ paddingHorizontal: 20, paddingTop: Spacing.two }}>
                    <Text
                        style={{
                            fontSize: 28,
                            fontFamily: Fonts?.rounded,
                            fontWeight: '800',
                            letterSpacing: -0.6,
                            color: theme.text,
                        }}
                    >
                        {i18n.t('routing_rules_title')}
                    </Text>
                    <Text
                        style={{
                            marginTop: 4,
                            fontSize: 13,
                            lineHeight: 18,
                            fontFamily: Fonts?.sans,
                            color: theme.textSecondary,
                        }}
                    >
                        {i18n.t('routing_rules_caption')}
                    </Text>
                </View>

                {showSearch ? (
                    <View style={{ paddingHorizontal: 16, marginTop: Spacing.three }}>
                        <TextInput
                            value={query}
                            onChangeText={setQuery}
                            placeholder={i18n.t('rule_search_placeholder')}
                            placeholderTextColor={`${theme.textSecondary}99`}
                            autoCapitalize="none"
                            autoCorrect={false}
                            spellCheck={false}
                            style={{
                                height: 40,
                                borderRadius: 12,
                                paddingHorizontal: 14,
                                fontSize: 15,
                                fontFamily: Fonts?.mono,
                                color: theme.text,
                                backgroundColor: `${theme.textSecondary}14`,
                            }}
                        />
                    </View>
                ) : null}

                {shown.length > 0 ? <View style={{ height: Spacing.three }} /> : null}
                    </>
                }
                ListEmptyComponent={
                    flat.length === 0 ? <EmptyState theme={theme} /> : <NoMatchState theme={theme} />
                }
                ListFooterComponent={
                    flat.length > 0 ? (
                        <Text
                            style={{
                                marginTop: Spacing.three,
                                marginHorizontal: 20,
                                fontSize: 12,
                                lineHeight: 16,
                                fontFamily: Fonts?.sans,
                                color: theme.textSecondary,
                                opacity: 0.7,
                            }}
                        >
                            {i18n.t('rule_restart_note')}
                        </Text>
                    ) : null
                }
            />

            <RuleComposerSheet
                ref={composerRef}
                initial={editing}
                onSubmit={handleSubmit}
                onDismiss={() => setEditing(null)}
            />
            <HelpSheet ref={helpRef} />
        </View>
    );
}

function EmptyState({ theme }: { theme: ReturnType<typeof useTheme> }) {
    return (
        <View
            style={{
                marginTop: Spacing.six,
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: 32,
            }}
        >
            <Ionicons name="git-network-outline" size={40} color={theme.textSecondary} />
            <Text
                style={{
                    marginTop: 12,
                    fontSize: 17,
                    fontWeight: '600',
                    fontFamily: Fonts?.rounded,
                    color: theme.text,
                    textAlign: 'center',
                }}
            >
                {i18n.t('rule_empty_title')}
            </Text>
            <Text
                style={{
                    marginTop: 6,
                    fontSize: 13,
                    lineHeight: 18,
                    fontFamily: Fonts?.sans,
                    color: theme.textSecondary,
                    textAlign: 'center',
                }}
            >
                {i18n.t('rule_empty_caption')}
            </Text>
        </View>
    );
}

function NoMatchState({ theme }: { theme: ReturnType<typeof useTheme> }) {
    return (
        <Text
            style={{
                marginTop: Spacing.six,
                fontSize: 13,
                lineHeight: 18,
                fontFamily: Fonts?.sans,
                color: theme.textSecondary,
                textAlign: 'center',
            }}
        >
            {i18n.t('rule_no_match')}
        </Text>
    );
}
