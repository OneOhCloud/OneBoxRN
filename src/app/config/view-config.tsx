/**
 * 配置查看器 — 只读地查看当前生效的配置。
 *
 * Apple 风格：类似 iOS UISegmentedControl 的分段、分组圆角卡片、
 * SF Pro / Menlo 字体、iOS 系统色、hairline 分隔线。
 *
 * 两种表示：
 *   Imported — 从当前配置文件源 URL 导入的原始内容。
 *   Merged   — 实际传给 sing-box 的配置：当前模式的模板，注入用户的
 *              outbound 并重写 DNS。通过 getProcessedConfig() 按需计算。
 */
import { lightImpact, selectionChanged } from '@/components/ui/haptics';
import i18n from '@/constants/language';
import { Spacing } from '@/constants/theme';
import { getProcessedConfig } from '@/database/helper';
import { ProfileConfig } from '@/database/kv';
import { useVpn } from '@/contexts/vpn-context';
import { VPN_STATUS } from '@/modules/expo-onebox';
import { useTheme } from '@/hooks/use-theme';
import { getSingBoxMajorVersion } from '@/utils/sing-box-version';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import React from 'react';
import {
    ActivityIndicator,
    FlatList,
    LayoutChangeEvent,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    ToastAndroid,
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

type Tab = 'imported' | 'merged';

interface MergedMeta {
    addedOutbounds: number;
    dns: string;
}

function prettyJson(raw: string): string {
    if (!raw) return '';
    try {
        return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
        return raw;
    }
}

function computeMergedMeta(rawImported: string, merged: string): MergedMeta | null {
    try {
        const importedObj = JSON.parse(rawImported);
        const mergedObj = JSON.parse(merged);
        const importedCount = Array.isArray(importedObj.outbounds) ? importedObj.outbounds.length : 0;
        const mergedCount = Array.isArray(mergedObj.outbounds) ? mergedObj.outbounds.length : 0;
        const addedOutbounds = Math.max(0, mergedCount - importedCount);

        let dns = '—';
        if (Array.isArray(mergedObj.dns?.servers)) {
            const system = mergedObj.dns.servers.find((s: { tag?: string }) => s?.tag === 'system');
            if (system?.server) dns = String(system.server);
        }
        return { addedOutbounds, dns };
    } catch {
        return null;
    }
}

// ─── iOS 风格分段控件 ────────────────────────────

/**
 * 复刻 iOS 13+ UISegmentedControl 外观：圆角轨道，选中分段下方有一个白色
 * "thumb"，用 spring 在各位置间滑动。iOS 上给 thumb 叠一层淡阴影；
 * Android 上改用 hairline 边框（项目规则 —— 动画视图上禁用 `elevation`）。
 */
function Segmented({ value, onChange }: { value: Tab; onChange: (v: Tab) => void }) {
    const theme = useTheme();
    const isDark = theme.text === '#ffffff';
    const trackBg = isDark ? 'rgba(118,118,128,0.24)' : 'rgba(120,120,128,0.12)';
    const thumbBg = isDark ? '#636366' : '#FFFFFF';

    const [trackW, setTrackW] = React.useState(0);
    const segW = trackW > 0 ? (trackW - 4) / 2 : 0;
    const thumbX = useSharedValue(2);

    React.useEffect(() => {
        const target = value === 'imported' ? 2 : 2 + segW;
        thumbX.value = withSpring(target, {
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
                {(['imported', 'merged'] as const).map((tab) => {
                    const selected = value === tab;
                    const label = tab === 'imported'
                        ? i18n.t('view_config_tab_imported')
                        : i18n.t('view_config_tab_merged');
                    const hint = tab === 'imported'
                        ? i18n.t('view_config_tab_imported_hint')
                        : i18n.t('view_config_tab_merged_hint');
                    return (
                        <Pressable
                            key={tab}
                            onPress={() => { if (!selected) { selectionChanged(); onChange(tab); } }}
                            accessibilityRole="button"
                            accessibilityLabel={label}
                            accessibilityHint={hint}
                            accessibilityState={{ selected }}
                            style={{
                                flex: 1,
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                        >
                            <Text
                                style={{
                                    fontSize: 13,
                                    color: theme.text,
                                    fontWeight: selected ? '600' : '400',
                                }}
                            >
                                {label}
                            </Text>
                        </Pressable>
                    );
                })}
            </View>
        </View>
    );
}

// ─── 导航栏 ────────────────────────────────────────────────

interface NavBarProps {
    title: string;
    onBack: () => void;
    right?: React.ReactNode;
    theme: ReturnType<typeof useTheme>;
}

/**
 * iOS 风格导航栏。标题居中且不可交互（`pointerEvents="none"`），
 * 因此绝不会抢走本该落在返回或右侧按钮上的点击。
 * 按钮有充足的 hitSlop（44pt 最小点击目标）。
 */
function NavBar({ title, onBack, right, theme }: NavBarProps) {
    return (
        <View
            style={{
                height: 44,
                justifyContent: 'center',
            }}
            pointerEvents="box-none"
        >
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

export default function ViewConfigScreen() {
    const theme = useTheme();
    const safeAreaInsets = useSafeAreaInsets();

    const [tab, setTab] = React.useState<Tab>('imported');
    // 同步 KV 读取 —— 惰性初始化让内容在首帧即可用，
    // 因此无需 loading 状态，也无需挂载后 setState。
    const [rawImported] = React.useState<string>(() => ProfileConfig.getConfigContent() ?? '');
    const [mergedState, setMergedState] = React.useState<
        | { kind: 'idle' }
        | { kind: 'loading' }
        | { kind: 'ready'; content: string; meta: MergedMeta | null }
        | { kind: 'error'; message: string }
    >({ kind: 'idle' });

    const mode = React.useMemo(() => ProfileConfig.getMode(), []);
    const version = React.useMemo(() => getSingBoxMajorVersion(), []);
    const { status, getStartConfig } = useVpn();

    const importedPretty = React.useMemo(
        () => rawImported ? prettyJson(rawImported) : '',
        [rawImported]
    );

    // 零 setState 的 reader：不触碰 React 就算出下一个 merged 状态，
    // 使自动加载 effect 从不同步地设置状态。
    const runMerge = React.useCallback(async (): Promise<typeof mergedState> => {
        try {
            const isRunning = status === VPN_STATUS.STARTED || status === VPN_STATUS.STARTING;
            const startCfg = isRunning ? getStartConfig() : '';
            const result = isRunning ? startCfg : await getProcessedConfig();
            const pretty = prettyJson(result);
            const meta = computeMergedMeta(rawImported, result);
            return { kind: 'ready', content: pretty, meta };
        } catch (e) {
            return { kind: 'error', message: (e as Error)?.message || String(e) };
        }
    }, [rawImported, status, getStartConfig]);

    // 重试按钮处理器 —— 事件上下文，这里同步 setState 没问题。
    const loadMerged = React.useCallback(() => {
        setMergedState({ kind: 'loading' });
        void runMerge().then(setMergedState);
    }, [runMerge]);

    // 自动加载只在 'idle' 时运行：加载失败会停留在错误面板，直到用户手动重试，
    // 避免对持续性失败无限自动重试。
    React.useEffect(() => {
        if (tab !== 'merged' || !rawImported || mergedState.kind !== 'idle') return;
        let cancelled = false;
        runMerge().then((next) => {
            if (!cancelled) setMergedState(next);
        });
        return () => { cancelled = true; };
    }, [tab, rawImported, mergedState.kind, runMerge]);

    // merged 标签页上的 'idle' 在渲染时推导：要么自动加载正在进行（→ loading
    // 面板），要么导入的配置为空、永远无法加载（→ error 面板）。不会有任何
    // 状态被写回。
    const effectiveMerged = React.useMemo<typeof mergedState>(() => {
        if (tab !== 'merged' || mergedState.kind !== 'idle') return mergedState;
        return rawImported
            ? { kind: 'loading' }
            : { kind: 'error', message: i18n.t('view_config_empty_title') };
    }, [tab, rawImported, mergedState]);

    const currentText: string | null = React.useMemo(() => {
        if (tab === 'imported') return rawImported ? importedPretty : null;
        if (effectiveMerged.kind === 'ready') return effectiveMerged.content;
        return null;
    }, [tab, rawImported, importedPretty, effectiveMerged]);

    const currentLines = React.useMemo(
        () => (currentText ? currentText.split('\n') : []),
        [currentText]
    );

    const handleCopy = async () => {
        if (!currentText) return;
        lightImpact();
        await Clipboard.setStringAsync(currentText);
        if (Platform.OS === 'android') {
            ToastAndroid.show(i18n.t('copied'), ToastAndroid.SHORT);
        }
    };

    const showCopy = currentText !== null && currentText.length > 0;
    const mergedMeta = tab === 'merged' && effectiveMerged.kind === 'ready' ? effectiveMerged.meta : null;

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
                title={i18n.t('view_config_title')}
                onBack={() => router.back()}
                theme={theme}
                right={
                    showCopy ? (
                        <Pressable
                            onPress={handleCopy}
                            accessibilityRole="button"
                            accessibilityLabel={i18n.t('view_config_copy')}
                            accessibilityHint={i18n.t('view_config_copy_hint')}
                            hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}
                            style={({ pressed }) => ({
                                paddingHorizontal: 10,
                                paddingVertical: 6,
                                opacity: pressed ? 0.4 : 1,
                            })}
                        >
                            <Ionicons name="copy-outline" size={22} color="#007AFF" />
                        </Pressable>
                    ) : null
                }
            />

            <View style={{ marginTop: Spacing.two }}>
                <Segmented value={tab} onChange={setTab} />
            </View>

            {/* 元信息说明行 */}
            <View
                style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingHorizontal: 20,
                    marginTop: Spacing.two + 2,
                    minHeight: 18,
                }}
            >
                <Text
                    style={{
                        fontSize: 12,
                        color: theme.textSecondary,
                    }}
                    numberOfLines={1}
                >
                    {i18n.t('view_config_meta_left', { version, mode })}
                </Text>
                {mergedMeta ? (
                    <Text
                        style={{
                            fontSize: 12,
                            color: theme.textSecondary,
                        }}
                        numberOfLines={1}
                    >
                        {i18n.t('view_config_meta_right', {
                            count: mergedMeta.addedOutbounds,
                            dns: mergedMeta.dns,
                        })}
                    </Text>
                ) : null}
            </View>

            {/* 配置卡片 */}
            <View
                style={{
                    flex: 1,
                    marginTop: Spacing.two + 2,
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
                {tab === 'imported'
                    ? rawImported === ''
                        ? <EmptyPanel
                            title={i18n.t('view_config_empty_title')}
                            subtitle={i18n.t('view_config_empty_desc')}
                            theme={theme}
                        />
                        : <ConfigBody lines={currentLines} theme={theme} />
                    : effectiveMerged.kind === 'loading'
                        ? <LoadingPanel label={i18n.t('view_config_loading')} theme={theme} />
                        : effectiveMerged.kind === 'error'
                            ? <ErrorPanel
                                title={i18n.t('view_config_error_title')}
                                detail={effectiveMerged.message}
                                retryLabel={i18n.t('view_config_retry')}
                                onRetry={loadMerged}
                                theme={theme}
                            />
                            : effectiveMerged.kind === 'ready'
                                ? <ConfigBody lines={currentLines} theme={theme} />
                                : null}
            </View>
        </View>
    );
}

// ─── 内容主体 ─────────────────────────────────────────────

function ConfigBody({ lines, theme }: { lines: string[]; theme: ReturnType<typeof useTheme> }) {
    const isDark = theme.text === '#ffffff';
    const gutterColor = isDark ? 'rgba(235,235,245,0.24)' : 'rgba(60,60,67,0.3)';
    const gutterWidth = Math.max(32, String(lines.length).length * 7 + 16);

    return (
        <FlatList
            data={lines}
            keyExtractor={(_, index) => `line-${index}`}
            initialNumToRender={50}
            maxToRenderPerBatch={30}
            windowSize={12}
            renderItem={({ item, index }) => (
                <View style={{ flexDirection: 'row', minHeight: 18 }}>
                    <Text
                        allowFontScaling={false}
                        style={{
                            width: gutterWidth,
                            fontFamily: MONO_FONT,
                            fontSize: 11,
                            lineHeight: 18,
                            color: gutterColor,
                            textAlign: 'right',
                            paddingRight: 8,
                        }}
                    >
                        {index + 1}
                    </Text>
                    <Text
                        allowFontScaling={false}
                        style={{
                            flex: 1,
                            fontFamily: MONO_FONT,
                            fontSize: 12,
                            lineHeight: 18,
                            color: theme.text,
                            paddingRight: 12,
                        }}
                    >
                        {item || ' '}
                    </Text>
                </View>
            )}
            contentContainerStyle={{ flexGrow: 1, paddingVertical: 10 }}
            showsVerticalScrollIndicator
        />
    );
}

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
            <Ionicons name="document-outline" size={40} color={theme.textSecondary} />
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

function LoadingPanel({
    label,
    theme,
}: {
    label: string;
    theme: ReturnType<typeof useTheme>;
}) {
    return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator size="small" color={theme.textSecondary} />
            <Text style={{ marginTop: 10, fontSize: 13, color: theme.textSecondary }}>
                {label}
            </Text>
        </View>
    );
}

function ErrorPanel({
    title,
    detail,
    retryLabel,
    onRetry,
    theme,
}: {
    title: string;
    detail: string;
    retryLabel: string;
    onRetry: () => void;
    theme: ReturnType<typeof useTheme>;
}) {
    return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
            <Ionicons name="alert-circle-outline" size={40} color="#FF9500" />
            <Text
                style={{
                    marginTop: 12,
                    fontSize: 17,
                    fontWeight: '600',
                    color: theme.text,
                    textAlign: 'center',
                }}
            >
                {title}
            </Text>
            <Text
                numberOfLines={3}
                ellipsizeMode="tail"
                style={{
                    marginTop: 6,
                    fontSize: 13,
                    lineHeight: 18,
                    color: theme.textSecondary,
                    textAlign: 'center',
                }}
            >
                {detail}
            </Text>
            <Pressable
                onPress={onRetry}
                accessibilityRole="button"
                accessibilityLabel={retryLabel}
                hitSlop={{ top: 12, bottom: 12, left: 24, right: 24 }}
                style={({ pressed }) => ({ marginTop: 16, opacity: pressed ? 0.4 : 1 })}
            >
                <Text style={{ fontSize: 17, color: '#007AFF' }}>{retryLabel}</Text>
            </Pressable>
        </View>
    );
}
