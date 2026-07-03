/**
 * 日志查看器 — 实时多源日志流。
 *
 * 通过 `useLogs()` 监听 `log-sink` 的外部 store，因此只有本屏在新日志到达
 * 时重渲染，即便有 1000 行缓冲区，app 其余部分也不受影响。
 *
 * 用 FlatList（而非 ScrollView）虚拟化渲染行；LogRow 经 React.memo 包裹并以
 * 单调递增的 `entry.id` 作 key，使行复用稳定、自动滚动不抖动。
 */
import { lightImpact, selectionChanged } from '@/components/ui/haptics';
import i18n from '@/constants/language';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { LogEntry, LogSource } from '@/utils/log-sink';
import { clearLogSink, useLogs } from '@/utils/log-sink';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    FlatList,
    LayoutChangeEvent,
    NativeScrollEvent,
    NativeSyntheticEvent,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from 'react-native-reanimated';

const MONO_FONT = Platform.select({
    ios: 'Menlo',
    android: 'monospace',
    default: 'ui-monospace',
})!;

// ─── ANSI 解析（sing-box 内核输出带颜色的行）──────

const ANSI_FG: Record<number, string> = {
    30: '#3a3a3c', 31: '#FF3B30', 32: '#34C759', 33: '#FFCC00',
    34: '#0A84FF', 35: '#BF5AF2', 36: '#32ADE6', 37: '#aeaeb2',
    90: '#636366', 91: '#FF6961', 92: '#30D158', 93: '#FFD60A',
    94: '#409CFF', 95: '#DA8FFF', 96: '#70D7FF', 97: '#f2f2f7',
};

interface AnsiSpan { text: string; color?: string; bold?: boolean }
interface AnsiState { color?: string; bold: boolean }

function parseAnsiLine(line: string): AnsiSpan[] {
    // 对纯文本行（无 ESC 字节）短路返回。多数 `info` 级别的 sing-box
    // 日志都是纯文本，跳过正则可省下热路径上的渲染时间。
    if (line.indexOf('\x1b') === -1) {
        return [{ text: line, bold: false }];
    }
    const spans: AnsiSpan[] = [];
    const re = /\x1b\[([0-9;]*)m/g;
    let lastIndex = 0;
    let state: AnsiState = { bold: false };
    let match: RegExpExecArray | null;
    while ((match = re.exec(line)) !== null) {
        if (match.index > lastIndex) {
            spans.push({ text: line.slice(lastIndex, match.index), ...state });
        }
        lastIndex = re.lastIndex;
        const codes = match[1] === '' ? [0] : match[1].split(';').map(Number);
        state = applyAnsiCodes(state, codes);
    }
    if (lastIndex < line.length) spans.push({ text: line.slice(lastIndex), ...state });
    return spans;
}

function applyAnsiCodes(prev: AnsiState, codes: number[]): AnsiState {
    const next: AnsiState = { ...prev };
    for (const c of codes) {
        if (c === 0) { next.color = undefined; next.bold = false; }
        else if (c === 1) next.bold = true;
        else if (c === 22) next.bold = false;
        else if ((c >= 30 && c <= 37) || (c >= 90 && c <= 97)) next.color = ANSI_FG[c];
        else if (c === 39) next.color = undefined;
    }
    return next;
}

// ─── 过滤模型 ───────────────────────────────────────────────

type Filter = 'all' | LogSource;
const FILTERS: Filter[] = ['all', 'sing-box', 'native', 'js'];

function filterLabel(f: Filter): string {
    switch (f) {
        case 'all':      return i18n.t('logs_filter_all');
        case 'sing-box': return i18n.t('logs_badge_singbox');
        case 'native':   return i18n.t('logs_filter_native');
        case 'js':       return 'JS';
    }
}

const SOURCE_DOT: Record<LogSource, string> = {
    'sing-box': '#AF52DE',
    native:     '#FF9500',
    js:         '#5AC8FA',
};

function sourceName(source: LogSource): string {
    switch (source) {
        case 'sing-box': return i18n.t('logs_badge_singbox');
        case 'native':   return i18n.t('logs_filter_native');
        case 'js':       return 'JS';
    }
}

function formatTime(ms: number): string {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ─── iOS 风格分段控件（4 段，单选）─

function Segmented({ value, onChange }: { value: Filter; onChange: (f: Filter) => void }) {
    const theme = useTheme();
    const isDark = theme.text === '#ffffff';
    const trackBg = isDark ? 'rgba(118,118,128,0.24)' : 'rgba(120,120,128,0.12)';
    const thumbBg = isDark ? '#636366' : '#FFFFFF';

    const [trackW, setTrackW] = useState(0);
    const segW = trackW > 0 ? (trackW - 4) / FILTERS.length : 0;
    const thumbX = useSharedValue(2);

    useEffect(() => {
        const idx = FILTERS.indexOf(value);
        thumbX.value = withSpring(2 + idx * segW, {
            damping: 22,
            stiffness: 260,
            mass: 0.9,
        });
    }, [value, segW, thumbX]);

    const thumbStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: thumbX.value }],
    }));

    return (
        <View
            onLayout={(e: LayoutChangeEvent) => setTrackW(e.nativeEvent.layout.width)}
            style={{
                height: 32,
                marginHorizontal: 16,
                borderRadius: 9,
                backgroundColor: trackBg,
                padding: 2,
                position: 'relative',
            }}
        >
            {segW > 0 && (
                <Animated.View
                    pointerEvents="none"
                    style={[
                        {
                            position: 'absolute',
                            top: 2,
                            left: 0,
                            width: segW,
                            height: 28,
                            borderRadius: 7,
                            backgroundColor: thumbBg,
                            ...Platform.select({
                                ios: {
                                    shadowColor: '#000',
                                    shadowOffset: { width: 0, height: 3 },
                                    shadowOpacity: 0.12,
                                    shadowRadius: 8,
                                },
                                android: {
                                    borderWidth: StyleSheet.hairlineWidth,
                                    borderColor: isDark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.08)',
                                },
                                default: {},
                            }),
                        },
                        thumbStyle,
                    ]}
                />
            )}
            <View style={{ flexDirection: 'row', flex: 1 }}>
                {FILTERS.map((f) => {
                    const selected = value === f;
                    return (
                        <Pressable
                            key={f}
                            onPress={() => {
                                if (!selected) { selectionChanged(); onChange(f); }
                            }}
                            accessibilityRole="button"
                            accessibilityLabel={filterLabel(f)}
                            accessibilityHint={f === 'all' ? i18n.t('logs_filter_all_hint') : i18n.t('logs_filter_source_hint')}
                            accessibilityState={{ selected }}
                            style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
                        >
                            <Text
                                style={{
                                    fontSize: 13,
                                    color: theme.text,
                                    fontWeight: selected ? '600' : '400',
                                }}
                                numberOfLines={1}
                            >
                                {filterLabel(f)}
                            </Text>
                        </Pressable>
                    );
                })}
            </View>
        </View>
    );
}

// ─── 日志行 ────────────────────────────────────────────────

// Row 在组件内部通过 `useTheme` 读取主题，好让 renderItem 保持稳定闭包 ——
// 否则高频日志流下每一行都会被判定为需要重渲染。
const LogRow = memo(function LogRow({ entry }: { entry: LogEntry }) {
    const theme = useTheme();
    const isError = entry.level === 'error';
    const isWarn = entry.level === 'warn';
    const showAnsi = entry.source === 'sing-box';
    const dot = SOURCE_DOT[entry.source];

    const messageColor = showAnsi
        ? theme.text
        : isError ? '#FF3B30'
        : isWarn ? '#FF9500'
        : theme.text;

    return (
        <View style={{ paddingHorizontal: 14, paddingVertical: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 3 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dot }} />
                <Text
                    style={{
                        marginLeft: 6,
                        fontSize: 11,
                        color: theme.textSecondary,
                        fontWeight: '500',
                    }}
                    numberOfLines={1}
                >
                    {sourceName(entry.source)}
                </Text>
                <Text
                    style={{
                        marginLeft: 6,
                        fontSize: 11,
                        color: theme.textSecondary,
                        opacity: 0.6,
                    }}
                >
                    · {formatTime(entry.time)}
                </Text>
                {isError ? (
                    <Text style={{ marginLeft: 6, fontSize: 11, color: '#FF3B30', fontWeight: '600' }}>
                        · {i18n.t('error')}
                    </Text>
                ) : null}
            </View>

            {showAnsi ? (
                <AnsiMessage line={entry.message} defaultColor={messageColor} />
            ) : (
                <Text
                    allowFontScaling={false}
                    style={{
                        fontFamily: MONO_FONT,
                        fontSize: 12,
                        lineHeight: 17,
                        color: messageColor,
                    }}
                >
                    {entry.message}
                </Text>
            )}
        </View>
    );
});

const LogRowSeparator = memo(function LogRowSeparator() {
    const theme = useTheme();
    return (
        <View
            style={{
                height: StyleSheet.hairlineWidth,
                backgroundColor: theme.border,
            }}
        />
    );
});

function AnsiMessage({ line, defaultColor }: { line: string; defaultColor: string }) {
    const spans = useMemo(() => parseAnsiLine(line), [line]);
    if (spans.length === 1 && !spans[0].color && !spans[0].bold) {
        return (
            <Text
                allowFontScaling={false}
                style={{
                    fontFamily: MONO_FONT,
                    fontSize: 12,
                    lineHeight: 17,
                    color: defaultColor,
                }}
            >
                {spans[0].text}
            </Text>
        );
    }
    return (
        <Text
            allowFontScaling={false}
            style={{ fontFamily: MONO_FONT, fontSize: 12, lineHeight: 17 }}
        >
            {spans.map((span, idx) => (
                <Text
                    key={idx}
                    style={{
                        color: span.color ?? defaultColor,
                        fontWeight: span.bold ? '700' : '400',
                    }}
                >
                    {span.text}
                </Text>
            ))}
        </Text>
    );
}

// ─── 导航栏 ────────────────────────────────────────────────

function NavBar({
    title,
    onBack,
    right,
    theme,
}: {
    title: string;
    onBack: () => void;
    right?: React.ReactNode;
    theme: ReturnType<typeof useTheme>;
}) {
    return (
        <View style={{ height: 44, justifyContent: 'center' }} pointerEvents="box-none">
            <Text
                pointerEvents="none"
                numberOfLines={1}
                style={{
                    textAlign: 'center',
                    fontSize: 17,
                    fontWeight: '600',
                    color: theme.text,
                    marginHorizontal: 96,
                }}
            >
                {title}
            </Text>

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
                <Ionicons name="chevron-back" size={22} color="#007AFF" />
                <Text style={{ color: '#007AFF', fontSize: 17, fontWeight: '400', marginLeft: 2 }}>
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

// ─── 屏幕 ─────────────────────────────────────────────────

/**
 * 渲染偏移低于此值即视为用户停留在"最新边缘"。
 * 在 inverted FlatList 中，`offset=0` 是视觉底部（最新条目）；阈值取得很小，
 * 使任何刻意的向上滚动都会关闭自动跟随。
 */
const NEAR_LATEST_THRESHOLD = 24;

export default function LogsViewerScreen() {
    const theme = useTheme();
    const safeAreaInsets = useSafeAreaInsets();
    const logs = useLogs();
    const listRef = useRef<FlatList<LogEntry>>(null);
    const [filter, setFilter] = useState<Filter>('all');
    const [showJumpToBottom, setShowJumpToBottom] = useState(false);

    const filtered = useMemo(
        () => (filter === 'all' ? logs : logs.filter((e) => e.source === filter)),
        [logs, filter]
    );

    // `scrollToEnd` 在行高动态且没有 `getItemLayout` 的 FlatList 上不可靠 ——
    // 它只能定位到目前已测量到的末端，会滞后于真正的末端。自动跟随日志视图
    // 的惯用做法是 `inverted` 列表：最新条目位于 `offset=0`（视觉底部），追加
    // 新数据无需滚动，"跳到最新"就是 `scrollToOffset({ offset: 0 })`。
    //
    // 下面的 `displayData` 反转缓冲区，使 index 0 为最新。
    const displayData = useMemo(() => {
        const out = new Array<LogEntry>(filtered.length);
        const last = filtered.length - 1;
        for (let i = 0; i <= last; i++) out[i] = filtered[last - i];
        return out;
    }, [filtered]);

    const handleClear = useCallback(() => {
        lightImpact();
        clearLogSink();
        setFilter('all');
        setShowJumpToBottom(false);
    }, []);

    // 反转坐标系：`contentOffset.y` 是离最新边缘（视觉底部）的距离，
    // 0 表示正看着最新条目。
    const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const offset = e.nativeEvent.contentOffset.y;
        const nearLatest = offset <= NEAR_LATEST_THRESHOLD;
        setShowJumpToBottom((prev) => (prev === !nearLatest ? prev : !nearLatest));
    }, []);

    const resumeAutoScroll = useCallback(() => {
        lightImpact();
        setShowJumpToBottom(false);
        listRef.current?.scrollToOffset({ offset: 0, animated: true });
    }, []);

    // 必须保持稳定闭包 —— 这里任何依赖变化都会让 FlatList 把每一行都当成
    // 新行、重新执行 renderItem（慢路径）。LogRow 通过 useTheme 自取颜色。
    const renderItem = useCallback(
        ({ item }: { item: LogEntry }) => <LogRow entry={item} />,
        []
    );

    const keyExtractor = useCallback((item: LogEntry) => String(item.id), []);

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
                title={i18n.t('logs_title')}
                onBack={() => router.back()}
                theme={theme}
                right={
                    logs.length > 0 ? (
                        <Pressable
                            onPress={handleClear}
                            accessibilityRole="button"
                            accessibilityLabel={i18n.t('logs_clear')}
                            accessibilityHint={i18n.t('logs_clear_hint')}
                            hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}
                            style={({ pressed }) => ({
                                paddingHorizontal: 10,
                                paddingVertical: 6,
                                opacity: pressed ? 0.4 : 1,
                            })}
                        >
                            <Text style={{ color: '#007AFF', fontSize: 17, fontWeight: '400' }}>
                                {i18n.t('logs_clear')}
                            </Text>
                        </Pressable>
                    ) : null
                }
            />

            <View style={{ marginTop: Spacing.two }}>
                <Segmented value={filter} onChange={setFilter} />
            </View>

            <View
                style={{
                    flex: 1,
                    marginTop: Spacing.three,
                    marginHorizontal: 16,
                    borderRadius: 14,
                    overflow: 'hidden',
                    backgroundColor: theme.cardBackground,
                    ...Platform.select({
                        ios: {
                            shadowColor: '#000',
                            shadowOffset: { width: 0, height: 1 },
                            shadowOpacity: 0.04,
                            shadowRadius: 3,
                        },
                        android: {
                            borderWidth: StyleSheet.hairlineWidth,
                            borderColor: theme.border,
                        },
                        default: {},
                    }),
                }}
            >
                {logs.length === 0 ? (
                    <EmptyPanel
                        title={i18n.t('logs_empty')}
                        subtitle={i18n.t('logs_empty_desc')}
                        theme={theme}
                    />
                ) : filtered.length === 0 ? (
                    <EmptyMatch theme={theme} />
                ) : (
                    <>
                        <FlatList
                            ref={listRef}
                            inverted
                            data={displayData}
                            keyExtractor={keyExtractor}
                            renderItem={renderItem}
                            ItemSeparatorComponent={LogRowSeparator}
                            // 列表内容短于视口时，`justifyContent: flex-end`
                            // 把条目推到未翻转内容的"末端"（经 inverted 变换后
                            // 视觉上是顶部）。否则条目会堆在视觉底部、上方留出
                            // 大片空白。
                            contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' }}
                            initialNumToRender={20}
                            maxToRenderPerBatch={10}
                            updateCellsBatchingPeriod={50}
                            windowSize={5}
                            removeClippedSubviews={false}
                            showsVerticalScrollIndicator
                            scrollEventThrottle={32}
                            onScroll={handleScroll}
                        />

                        {showJumpToBottom ? (
                            <Pressable
                                onPress={resumeAutoScroll}
                                accessibilityRole="button"
                                accessibilityLabel={i18n.t('logs_resume_autoscroll')}
                                style={({ pressed }) => ({
                                    position: 'absolute',
                                    bottom: 14,
                                    alignSelf: 'center',
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    paddingHorizontal: 14,
                                    paddingVertical: 8,
                                    borderRadius: 18,
                                    backgroundColor: '#007AFF',
                                    opacity: pressed ? 0.75 : 1,
                                    ...Platform.select({
                                        ios: {
                                            shadowColor: '#000',
                                            shadowOffset: { width: 0, height: 2 },
                                            shadowOpacity: 0.18,
                                            shadowRadius: 6,
                                        },
                                        android: {
                                            borderWidth: StyleSheet.hairlineWidth,
                                            borderColor: 'rgba(255,255,255,0.24)',
                                        },
                                        default: {},
                                    }),
                                })}
                            >
                                <Ionicons name="arrow-down" size={14} color="#FFFFFF" />
                                <Text style={{
                                    marginLeft: 6,
                                    color: '#FFFFFF',
                                    fontSize: 13,
                                    fontWeight: '500',
                                }}>
                                    {i18n.t('logs_resume_autoscroll')}
                                </Text>
                            </Pressable>
                        ) : null}
                    </>
                )}
            </View>
        </View>
    );
}

// ─── 内容区状态面板 ──────────────────────────────────────────

function EmptyPanel({
    title,
    subtitle,
    theme,
}: {
    title: string;
    subtitle: string;
    theme: ReturnType<typeof useTheme>;
}) {
    return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
            <Ionicons name="document-text-outline" size={40} color={theme.textSecondary} />
            <Text style={{ marginTop: 12, fontSize: 17, fontWeight: '600', color: theme.text, textAlign: 'center' }}>
                {title}
            </Text>
            <Text
                style={{
                    marginTop: 6,
                    fontSize: 13,
                    lineHeight: 18,
                    color: theme.textSecondary,
                    textAlign: 'center',
                }}
            >
                {subtitle}
            </Text>
        </View>
    );
}

function EmptyMatch({ theme }: { theme: ReturnType<typeof useTheme> }) {
    return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
            <Text style={{ fontSize: 15, color: theme.textSecondary, textAlign: 'center' }}>
                {i18n.t('logs_filter_no_match')}
            </Text>
        </View>
    );
}
