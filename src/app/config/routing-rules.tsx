/**
 * Routing Rules — user-managed custom (action, kind, value) matchers.
 *
 * One RuleSet per action (reject / direct / proxy) is loaded from the KV
 * store, flattened + sorted for display, and edited through a shared bottom
 * sheet composer. Any mutation persists via setCustomRuleSet and then asks the
 * tunnel to restart with the fresh config (requestVpnRestart no-ops when the
 * tunnel is down). The screen never touches the native module directly.
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
import { requestVpnRestart } from '@/utils/vpn-restart';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheetModal } from '@gorhom/bottom-sheet';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    Platform,
    Pressable,
    ScrollView,
    Text,
    TextInput,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Rules are flattened from the three action sets, so search is enabled only
// once the list is long enough to be worth scanning.
const SEARCH_THRESHOLD = 12;

function makeEmptySets(): Record<RuleAction, RuleSet> {
    return { reject: emptyRuleSet(), direct: emptyRuleSet(), proxy: emptyRuleSet() };
}

/** Replace one kind's values inside a RuleSet, leaving the others untouched. */
function withKind(set: RuleSet, kind: RuleKind, values: string[]): RuleSet {
    return { ...set, [kind]: values };
}

function NavBar({
    onBack,
    right,
    theme,
}: {
    onBack: () => void;
    right?: React.ReactNode;
    theme: ReturnType<typeof useTheme>;
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

            // An edit can move a rule across action/kind, so drop the original
            // value from its old set before merging into the target set.
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
            requestVpnRestart();
            composerRef.current?.dismiss();
        },
        [sets, editing],
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
                        requestVpnRestart();
                    },
                },
            ]);
        },
        [sets],
    );

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
                theme={theme}
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

            <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: Spacing.six }}
                keyboardShouldPersistTaps="handled"
            >
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

                {flat.length === 0 ? (
                    <EmptyState theme={theme} />
                ) : shown.length === 0 ? (
                    <NoMatchState theme={theme} />
                ) : (
                    <View style={{ marginTop: Spacing.three }}>
                        {shown.map((rule) => (
                            <View
                                key={`${rule.action}:${rule.kind}:${rule.value}`}
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
                                    rule={rule}
                                    onEdit={() => presentEdit(rule)}
                                    onDelete={() => handleDelete(rule)}
                                />
                            </View>
                        ))}
                    </View>
                )}

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
            </ScrollView>

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
