/**
 * Config Viewer — read-only inspection of the active config.
 *
 * Apple-style: iOS UISegmentedControl-like tab, grouped rounded card,
 * SF Pro / Menlo typography, iOS system colors, hairline separators.
 *
 * Two representations:
 *   Imported — raw content imported from the active profile's source URL.
 *   Merged   — the config actually passed to sing-box: template for the
 *              current mode with the user's outbounds injected and DNS
 *              rewritten. Computed on-demand via getProcessedConfig().
 */
import { lightImpact, selectionChanged } from '@/components/ui/haptics';
import i18n from '@/constants/language';
import { Spacing } from '@/constants/theme';
import { getProcessedConfig } from '@/database/helper';
import { SBConfig } from '@/database/kv';
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

// ─── iOS-style Segmented Control ────────────────────────────

/**
 * Matches the iOS 13+ UISegmentedControl appearance: rounded track with
 * a white "thumb" under the selected segment that slides between
 * positions with a spring. On iOS we layer a subtle shadow on the thumb;
 * on Android we substitute a hairline border (project rule — no
 * `elevation` on animated views).
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

// ─── Nav bar ────────────────────────────────────────────────

interface NavBarProps {
    title: string;
    onBack: () => void;
    right?: React.ReactNode;
    theme: ReturnType<typeof useTheme>;
}

/**
 * iOS-style nav bar. Title is centred and non-interactive
 * (`pointerEvents="none"`) so it never eats taps meant for the back or
 * right buttons — which was the regression the prior iteration shipped.
 * Buttons have generous hitSlop (44pt minimum tap target).
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

// ─── Screen ─────────────────────────────────────────────────

export default function ViewConfigScreen() {
    const theme = useTheme();
    const safeAreaInsets = useSafeAreaInsets();

    const [tab, setTab] = React.useState<Tab>('imported');
    const [rawImported, setRawImported] = React.useState<string | null>(null);
    const [mergedState, setMergedState] = React.useState<
        | { kind: 'idle' }
        | { kind: 'loading' }
        | { kind: 'ready'; content: string; meta: MergedMeta | null }
        | { kind: 'error'; message: string }
    >({ kind: 'idle' });

    const mode = React.useMemo(() => SBConfig.getMode(), []);
    const version = React.useMemo(() => getSingBoxMajorVersion(), []);
    const { status, getStartConfig } = useVpn();

    React.useEffect(() => {
        const start = Date.now();
        const raw = SBConfig.getConfigContent();
        setRawImported(raw ?? '');
        console.log(`Config content loaded in ${Date.now() - start}ms`);
    }, []);

    const importedPretty = React.useMemo(
        () => rawImported ? prettyJson(rawImported) : '',
        [rawImported]
    );

    const loadMerged = React.useCallback(async () => {
        setMergedState({ kind: 'loading' });
        try {
            const isRunning = status === VPN_STATUS.STARTED || status === VPN_STATUS.STARTING;
            const startCfg = isRunning ? getStartConfig() : '';
            const result = isRunning ? startCfg : await getProcessedConfig();
            const pretty = prettyJson(result);
            const meta = computeMergedMeta(rawImported ?? '', result);
            setMergedState({ kind: 'ready', content: pretty, meta });
        } catch (e) {
            setMergedState({ kind: 'error', message: (e as Error)?.message || String(e) });
        }
    }, [rawImported, status, getStartConfig]);

    React.useEffect(() => {
        if (tab !== 'merged') return;
        if (mergedState.kind === 'idle' || mergedState.kind === 'error') {
            if (rawImported === null) return;
            if (!rawImported) {
                setMergedState({ kind: 'error', message: i18n.t('view_config_empty_title') });
                return;
            }
            void loadMerged();
        }
    }, [tab, rawImported, mergedState.kind, loadMerged]);

    const currentText: string | null = React.useMemo(() => {
        if (tab === 'imported') return rawImported ? importedPretty : null;
        if (mergedState.kind === 'ready') return mergedState.content;
        return null;
    }, [tab, rawImported, importedPretty, mergedState]);

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
    const mergedMeta = tab === 'merged' && mergedState.kind === 'ready' ? mergedState.meta : null;

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

            {/* Meta caption row */}
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

            {/* Config card */}
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
                    ? rawImported === null
                        ? <LoadingPanel label={i18n.t('loading')} theme={theme} />
                        : rawImported === ''
                            ? <EmptyPanel
                                title={i18n.t('view_config_empty_title')}
                                subtitle={i18n.t('view_config_empty_desc')}
                                theme={theme}
                            />
                            : <ConfigBody lines={currentLines} theme={theme} />
                    : mergedState.kind === 'loading'
                        ? <LoadingPanel label={i18n.t('view_config_loading')} theme={theme} />
                        : mergedState.kind === 'error'
                            ? <ErrorPanel
                                title={i18n.t('view_config_error_title')}
                                detail={mergedState.message}
                                retryLabel={i18n.t('view_config_retry')}
                                onRetry={loadMerged}
                                theme={theme}
                            />
                            : mergedState.kind === 'ready'
                                ? <ConfigBody lines={currentLines} theme={theme} />
                                : null}
            </View>
        </View>
    );
}

// ─── Content bodies ─────────────────────────────────────────

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
