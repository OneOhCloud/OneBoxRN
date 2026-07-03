/**
 * Dev-Smoke route — auto-runs the full import + smoke suite on mount.
 *
 * Reached via `oneoh-networktools://dev-smoke` (fired by
 * `make dev-smoke-ios` / `make dev-smoke-android`). The native-import
 * smoke set runs first (bridge reachability), then import-flow cases.
 *
 * UI choices (non-obvious):
 *   - Results grouped by `TestCase.group` in collapsible glass cards.
 *     Flat list was unreadable once the combined suite crossed ~30 rows.
 *   - Filter chips ("All / Failing / Running / Passing") above groups;
 *     `Running` chip only appears while something is running.
 *   - Cards use `useGlassSurface()` for consistency with tab screens.
 *     Rejected: hand-rolled StyleSheet hairlines (prior look).
 *   - Rejected: nested ScrollViews per group — single outer ScrollView
 *     handles ~40 rows fine and nested scrolling is a UX trap on both
 *     platforms.
 *   - No `elevation` on Android (see CLAUDE.md § Shadow / Elevation):
 *     glass hairline border does the lift suggestion instead.
 *
 * Never expose this from production UI — deep link / direct nav only.
 */
import { lightImpact, mediumImpact } from '@/components/ui/haptics';
import { useGlassSurface } from '@/constants/ios26-palette';
import { Fonts, Spacing } from '@/constants/theme';
import { IMPORT_TEST_CASES } from '@/debug/import-tests/cases';
import {
    buildReport,
    runAll,
    type TestGroup,
    type TestResult,
    type TestStatus,
} from '@/debug/import-tests/runner';
import { SMOKE_IMPORT_ENTRIES } from '@/debug/smoke-imports/entries';
import { useTheme } from '@/hooks/use-theme';
import { jsLog } from '@/utils/log-sink';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const FULL_SUITE = [...SMOKE_IMPORT_ENTRIES, ...IMPORT_TEST_CASES];

const STATUS_COLOR: Record<TestStatus, string> = {
    pending: '#8E8E93',
    running: '#007AFF',
    pass: '#34C759',
    fail: '#FF3B30',
    error: '#FF9500',
};

const STATUS_LABEL: Record<TestStatus, string> = {
    pending: '—',
    running: '…',
    pass: 'PASS',
    fail: 'FAIL',
    error: 'ERROR',
};

// Fixed group order; unknown groups fall to the end. `import` first
// because its failure invalidates every flow-level case below it.
const GROUP_ORDER: readonly TestGroup[] = ['import', 'parse', 'crypto', 'verify', 'apply'];
const GROUP_LABEL: Record<TestGroup, string> = {
    import: 'Native Imports',
    parse: 'Parse',
    crypto: 'Crypto',
    verify: 'Verify',
    apply: 'Apply',
};

type FilterKind = 'all' | 'failing' | 'running' | 'passing';

function matchesFilter(status: TestStatus, filter: FilterKind): boolean {
    switch (filter) {
        case 'all': return true;
        case 'failing': return status === 'fail' || status === 'error';
        case 'running': return status === 'running';
        case 'passing': return status === 'pass';
    }
}

interface GroupBucket {
    group: TestGroup;
    rows: TestResult[];
    total: number;
    pass: number;
    failing: number;
    running: number;
    durationMs: number;
}

function initialResults(): TestResult[] {
    return FULL_SUITE.map(c => ({
        id: c.id,
        name: c.name,
        group: c.group,
        status: 'pending' as TestStatus,
        startedAt: null,
        finishedAt: null,
        durationMs: null,
        message: null,
        stack: null,
        logs: [],
    }));
}

function bucketResults(results: readonly TestResult[]): GroupBucket[] {
    const byGroup = new Map<TestGroup, TestResult[]>();
    for (const r of results) {
        const arr = byGroup.get(r.group) ?? [];
        arr.push(r);
        byGroup.set(r.group, arr);
    }
    const buckets: GroupBucket[] = [];
    for (const [group, rows] of byGroup.entries()) {
        let pass = 0, failing = 0, running = 0, durationMs = 0;
        for (const r of rows) {
            if (r.status === 'pass') pass += 1;
            else if (r.status === 'fail' || r.status === 'error') failing += 1;
            else if (r.status === 'running') running += 1;
            durationMs += r.durationMs ?? 0;
        }
        buckets.push({ group, rows, total: rows.length, pass, failing, running, durationMs });
    }
    buckets.sort((a, b) => {
        const ai = GROUP_ORDER.indexOf(a.group);
        const bi = GROUP_ORDER.indexOf(b.group);
        return (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) - (bi < 0 ? Number.MAX_SAFE_INTEGER : bi);
    });
    return buckets;
}

export default function DevSmokeScreen() {
    const theme = useTheme();
    const glass = useGlassSurface();
    const [results, setResults] = useState<TestResult[]>(initialResults);
    const [running, setRunning] = useState(false);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [collapsedGroups, setCollapsedGroups] = useState<Set<TestGroup>>(new Set());
    const [filter, setFilter] = useState<FilterKind>('all');
    const autoStartedRef = useRef(false);

    const summary = useMemo(() => {
        const pass = results.filter(r => r.status === 'pass').length;
        const fail = results.filter(r => r.status === 'fail').length;
        const error = results.filter(r => r.status === 'error').length;
        const runningCount = results.filter(r => r.status === 'running').length;
        const duration = results.reduce((acc, r) => acc + (r.durationMs ?? 0), 0);
        return { total: results.length, pass, fail, error, running: runningCount, duration };
    }, [results]);

    const buckets = useMemo(() => bucketResults(results), [results]);

    const runSuite = async () => {
        if (running) return;
        setRunning(true);
        setResults(initialResults());
        setExpanded(new Set());
        let final: TestResult[] = [];
        try {
            await runAll(FULL_SUITE, (_r, all) => { final = all; setResults(all.slice()); });
        } finally {
            setRunning(false);
            const failing = final.filter(r => r.status === 'fail' || r.status === 'error');
            const pass = final.filter(r => r.status === 'pass').length;
            // Machine-parseable acceptance marker (see CLAUDE.md dev harness).
            jsLog.info(`[[HARNESS]] op=devsmoke phase=done total=${final.length} pass=${pass} fail=${failing.length}` +
                (failing.length ? ` failures=${failing.map(r => r.id).join(',')}` : ''));
        }
    };

    // StrictMode double-mount guard — the whole point of the deep link
    // is to fire the suite without user interaction on first mount.
    useEffect(() => {
        if (autoStartedRef.current) return;
        autoStartedRef.current = true;
        void runSuite();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleCopyReport = async () => {
        mediumImpact();
        const report = buildReport(results);
        try {
            await Clipboard.setStringAsync(JSON.stringify(report, null, 2));
            Alert.alert('Report copied', `${summary.pass}/${summary.total} passed · copied to clipboard.`);
        } catch (e) {
            Alert.alert('Copy failed', e instanceof Error ? e.message : String(e));
        }
    };

    const toggleExpanded = (id: string) => {
        lightImpact();
        setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const toggleGroup = (group: TestGroup) => {
        lightImpact();
        setCollapsedGroups(prev => {
            const next = new Set(prev);
            if (next.has(group)) next.delete(group); else next.add(group);
            return next;
        });
    };

    const selectFilter = (kind: FilterKind) => {
        lightImpact();
        setFilter(kind);
    };

    const bannerColor = running
        ? '#007AFF'
        : summary.fail + summary.error > 0 ? '#FF3B30' : '#34C759';

    const bannerText = running
        ? `Running… ${summary.pass + summary.fail + summary.error}/${summary.total}`
        : summary.fail + summary.error === 0
          ? `All ${summary.total} checks passed`
          : `${summary.fail} failed, ${summary.error} error, ${summary.pass} passed`;

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
            <View style={styles.header}>
                <Pressable
                    onPress={() => router.back()}
                    style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.55 : 1 }]}
                    hitSlop={8}
                >
                    <Ionicons name="chevron-back" size={22} color="#007AFF" />
                </Pressable>
                <Text numberOfLines={1} style={[styles.title, { color: theme.text }]}>
                    Import Smoke Check
                </Text>
                <View style={{ width: 44 }} />
            </View>

            <View style={{ paddingHorizontal: Spacing.three, paddingBottom: Spacing.two }}>
                <View
                    style={{
                        borderRadius: 14,
                        padding: 14,
                        backgroundColor: bannerColor + '18',
                        borderWidth: StyleSheet.hairlineWidth,
                        borderColor: bannerColor + '55',
                    }}
                >
                    <Text style={[styles.bannerTitle, { color: bannerColor }]}>{bannerText}</Text>
                    <Text style={[styles.bannerSub, { color: theme.textSecondary }]}>
                        {summary.duration}ms total · deep-link trigger via `make dev-smoke-*`
                    </Text>
                </View>
            </View>

            <FilterChips
                filter={filter}
                onSelect={selectFilter}
                showRunning={summary.running > 0}
                counts={{
                    all: summary.total,
                    failing: summary.fail + summary.error,
                    running: summary.running,
                    passing: summary.pass,
                }}
            />

            <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{
                    paddingHorizontal: Spacing.three,
                    paddingBottom: 80,
                    paddingTop: Spacing.one,
                }}
                showsVerticalScrollIndicator={false}
            >
                {buckets.map(b => (
                    <GroupSection
                        key={b.group}
                        bucket={b}
                        collapsed={collapsedGroups.has(b.group)}
                        onToggleGroup={toggleGroup}
                        expanded={expanded}
                        onToggleRow={toggleExpanded}
                        filter={filter}
                        glass={glass}
                    />
                ))}
            </ScrollView>

            <View style={styles.actionBar}>
                <BarButton label={running ? 'Running…' : 'Re-run'} primary disabled={running} onPress={runSuite} />
                <BarButton label="Copy Report" disabled={running} onPress={handleCopyReport} />
            </View>
        </SafeAreaView>
    );
}

function FilterChips({
    filter,
    onSelect,
    showRunning,
    counts,
}: {
    filter: FilterKind;
    onSelect: (kind: FilterKind) => void;
    showRunning: boolean;
    counts: { all: number; failing: number; running: number; passing: number };
}) {
    type ChipData = { kind: FilterKind; label: string; count: number };
    const chips: ChipData[] = [
        { kind: 'all', label: 'All', count: counts.all },
        { kind: 'failing', label: 'Failing', count: counts.failing },
        ...(showRunning ? [{ kind: 'running' as FilterKind, label: 'Running', count: counts.running }] : []),
        { kind: 'passing', label: 'Passing', count: counts.passing },
    ];
    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            // What we deliberately DON'T do: leave FilterChips without
            // explicit flex sizing. Reason: with two flex-shrinkable
            // ScrollView siblings in this column, RN's flex negotiation
            // would let the main content ScrollView's intrinsic height
            // drive this row's height — so expanding a GroupSection
            // squeezes the chips and collapsing everything stretches
            // them. flexGrow:0/flexShrink:0 pins this row to content
            // height.
            style={styles.filterChipsRow}
            contentContainerStyle={styles.filterChipsContent}
        >
            {chips.map(c => (
                <Chip key={c.kind} chip={c} active={filter === c.kind} onPress={() => onSelect(c.kind)} />
            ))}
        </ScrollView>
    );
}

function Chip({
    chip,
    active,
    onPress,
}: {
    chip: { kind: FilterKind; label: string; count: number };
    active: boolean;
    onPress: () => void;
}) {
    const theme = useTheme();
    const glass = useGlassSurface();
    return (
        <Pressable
            onPress={onPress}
            hitSlop={6}
            style={({ pressed }) => ({
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 16,
                backgroundColor: active ? '#007AFF' : (glass.backgroundColor ?? 'transparent'),
                borderWidth: active ? 0 : StyleSheet.hairlineWidth,
                borderColor: theme.glassBorder,
                opacity: pressed ? 0.65 : 1,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
            })}
        >
            <Text numberOfLines={1} style={[styles.chipLabel, { color: active ? '#ffffff' : theme.text }]}>
                {chip.label}
            </Text>
            <Text
                numberOfLines={1}
                style={[
                    styles.chipCount,
                    { color: active ? '#ffffff' : theme.textSecondary, opacity: active ? 0.85 : 1 },
                ]}
            >
                {chip.count}
            </Text>
        </Pressable>
    );
}

function GroupSection({
    bucket,
    collapsed,
    onToggleGroup,
    expanded,
    onToggleRow,
    filter,
    glass,
}: {
    bucket: GroupBucket;
    collapsed: boolean;
    onToggleGroup: (g: TestGroup) => void;
    expanded: Set<string>;
    onToggleRow: (id: string) => void;
    filter: FilterKind;
    glass: ViewStyle;
}) {
    const theme = useTheme();
    const visibleRows = useMemo(
        () => bucket.rows.filter(r => matchesFilter(r.status, filter)),
        [bucket.rows, filter],
    );

    // Hide empty groups under an active filter.
    if (filter !== 'all' && visibleRows.length === 0) return null;

    const headerTint = bucket.failing > 0
        ? STATUS_COLOR.fail
        : bucket.running > 0
            ? STATUS_COLOR.running
            : bucket.pass === bucket.total && bucket.total > 0
                ? STATUS_COLOR.pass
                : null;

    return (
        <View style={[glass, styles.groupCard]}>
            <Pressable
                onPress={() => onToggleGroup(bucket.group)}
                style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
            >
                <View
                    style={[
                        styles.groupHeader,
                        { backgroundColor: headerTint ? headerTint + '14' : 'transparent' },
                    ]}
                >
                    <Ionicons
                        name={collapsed ? 'chevron-forward' : 'chevron-down'}
                        size={16}
                        color={theme.textSecondary}
                    />
                    <Text style={[styles.groupTitle, { color: theme.text }]}>
                        {GROUP_LABEL[bucket.group] ?? bucket.group}
                    </Text>
                    {collapsed && bucket.failing > 0 && (
                        <View style={[styles.failingBadge, { backgroundColor: STATUS_COLOR.fail + '22' }]}>
                            <Text style={[styles.failingBadgeText, { color: STATUS_COLOR.fail }]}>
                                {bucket.failing} failing
                            </Text>
                        </View>
                    )}
                    <Text style={[styles.groupCount, { color: headerTint ?? theme.textSecondary }]}>
                        {bucket.pass}/{bucket.total}
                        {bucket.durationMs > 0 ? ` · ${bucket.durationMs}ms` : ''}
                    </Text>
                </View>
            </Pressable>

            {!collapsed && visibleRows.map((r, i) => (
                <ResultRow
                    key={r.id}
                    result={r}
                    expanded={expanded.has(r.id)}
                    onToggle={onToggleRow}
                    isLast={i === visibleRows.length - 1}
                />
            ))}
        </View>
    );
}

function ResultRow({
    result,
    expanded,
    onToggle,
    isLast,
}: {
    result: TestResult;
    expanded: boolean;
    onToggle: (id: string) => void;
    isLast: boolean;
}) {
    const theme = useTheme();
    const hasDetail = result.message !== null || result.stack !== null || result.logs.length > 0;
    return (
        <View>
            <Pressable
                onPress={hasDetail ? () => onToggle(result.id) : undefined}
                style={({ pressed }) => ({ opacity: pressed && hasDetail ? 0.55 : 1 })}
            >
                <View style={styles.row}>
                    <View
                        style={[styles.statusDot, { backgroundColor: STATUS_COLOR[result.status] }]}
                    />
                    <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={2} style={[styles.rowName, { color: theme.text }]}>
                            {result.name}
                        </Text>
                        <Text numberOfLines={1} style={[styles.rowMeta, { color: theme.textSecondary }]}>
                            {result.id}
                            {result.durationMs !== null ? ` · ${result.durationMs}ms` : ''}
                        </Text>
                    </View>
                    <Text style={[styles.rowStatus, { color: STATUS_COLOR[result.status] }]}>
                        {STATUS_LABEL[result.status]}
                    </Text>
                </View>
            </Pressable>

            {expanded && hasDetail && (
                <View style={{ paddingHorizontal: 14, paddingBottom: 10 }}>
                    {result.message && (
                        <Text style={[styles.detailMessage, { color: STATUS_COLOR[result.status] }]}>
                            {result.message}
                        </Text>
                    )}
                    {result.logs.length > 0 && (
                        <Text style={[styles.detailLogs, { color: theme.textSecondary }]}>
                            {result.logs.join('\n')}
                        </Text>
                    )}
                    {result.stack && result.status === 'error' && (
                        <Text style={[styles.detailStack, { color: theme.textSecondary }]}>
                            {result.stack}
                        </Text>
                    )}
                </View>
            )}

            {!isLast && (
                <View
                    style={{
                        height: StyleSheet.hairlineWidth,
                        marginLeft: 14,
                        backgroundColor: theme.glassBorder,
                    }}
                />
            )}
        </View>
    );
}

function BarButton({
    label,
    primary,
    disabled,
    onPress,
}: {
    label: string;
    primary?: boolean;
    disabled: boolean;
    onPress: () => void;
}) {
    const theme = useTheme();
    const glass = useGlassSurface();
    return (
        <Pressable
            onPress={disabled ? undefined : onPress}
            style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 12,
                borderRadius: 12,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: primary ? '#007AFF' : (glass.backgroundColor ?? theme.glassBackground),
                borderWidth: primary ? 0 : StyleSheet.hairlineWidth,
                borderColor: theme.glassBorder,
                opacity: disabled ? 0.4 : pressed ? 0.65 : 1,
            })}
            disabled={disabled}
        >
            <Text style={[styles.barBtnLabel, { color: primary ? '#ffffff' : theme.text }]}>
                {label}
            </Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: Spacing.two,
        paddingVertical: Spacing.one,
        minHeight: 44,
    },
    backBtn: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
    },
    title: {
        flex: 1,
        textAlign: 'center',
        fontSize: 17,
        fontWeight: '600',
        fontFamily: Fonts?.sans,
    },
    bannerTitle: {
        fontSize: 15,
        fontWeight: '600',
        fontFamily: Fonts?.rounded,
    },
    bannerSub: {
        fontSize: 12,
        marginTop: 3,
        fontFamily: Fonts?.mono,
    },
    filterChipsRow: {
        flexGrow: 0,
        flexShrink: 0,
    },
    filterChipsContent: {
        paddingHorizontal: Spacing.three,
        paddingBottom: Spacing.two,
        gap: Spacing.two,
    },
    chipLabel: {
        fontSize: 13,
        fontWeight: '600',
        fontFamily: Fonts?.rounded,
        letterSpacing: -0.1,
    },
    chipCount: {
        fontSize: 11,
        fontFamily: Fonts?.mono,
    },
    groupCard: {
        marginBottom: Spacing.two,
        padding: 0,
        overflow: 'hidden',
    },
    groupHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingVertical: 12,
        gap: 10,
    },
    groupTitle: {
        flex: 1,
        fontSize: 14,
        fontWeight: '600',
        fontFamily: Fonts?.rounded,
        letterSpacing: -0.15,
    },
    groupCount: {
        fontSize: 12,
        fontFamily: Fonts?.mono,
        letterSpacing: 0.1,
    },
    failingBadge: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 10,
    },
    failingBadgeText: {
        fontSize: 11,
        fontFamily: Fonts?.mono,
        fontWeight: '600',
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingVertical: 10,
        gap: 10,
    },
    statusDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
    },
    rowName: {
        fontSize: 14,
        fontFamily: Fonts?.sans,
        letterSpacing: -0.15,
    },
    rowMeta: {
        fontSize: 11,
        fontFamily: Fonts?.mono,
        marginTop: 1,
    },
    rowStatus: {
        fontSize: 11,
        fontFamily: Fonts?.mono,
        fontWeight: '600',
        letterSpacing: 0.2,
    },
    detailMessage: {
        fontSize: 12,
        fontFamily: Fonts?.mono,
        marginBottom: 6,
    },
    detailLogs: {
        fontSize: 11,
        fontFamily: Fonts?.mono,
        lineHeight: 15,
    },
    detailStack: {
        fontSize: 10,
        fontFamily: Fonts?.mono,
        opacity: 0.7,
        marginTop: 6,
    },
    actionBar: {
        position: 'absolute',
        bottom: Spacing.three,
        left: Spacing.three,
        right: Spacing.three,
        flexDirection: 'row',
        gap: Spacing.two,
    },
    barBtnLabel: {
        fontSize: 15,
        fontWeight: '600',
        fontFamily: Fonts?.rounded,
        letterSpacing: -0.2,
    },
});
