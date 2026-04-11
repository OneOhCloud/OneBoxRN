/**
 * Config Import Screen — downloads and displays profile configuration.
 * Reached via deep link or QR scan with base64-encoded URL in search params.
 */
import { mediumImpact, notifyError, notifySuccess } from '@/components/ui/haptics';
import i18n from '@/constants/language';
import { Fonts } from '@/constants/theme';
import { fmtBytes } from '@/components/ui/home/profile-info-card';
import { getProcessedConfig } from '@/database/helper';
import { ProfileStore } from '@/database/kv';
import { useTheme } from '@/hooks/use-theme';
import ExpoOneBox, { VPN_STATUS } from '@/modules/expo-onebox';
import { fetchWithTimeout, getRemoteNameByContentDisposition, getSingBoxUserAgent, urlHostname } from '@/utils';
import { parseProfileUserinfo } from '@/utils/profile-info';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// ─── Download Hook ──────────────────────────────────────────
function useDownloadConfig(url: string | undefined) {
    const [data, setData] = useState<string | null>(null);
    const [error, setError] = useState<Error | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [extraInfo, setExtraInfo] = useState<{
        upload: number;
        download: number;
        total: number;
        expire: number;
    } | null>(null);

    useEffect(() => {
        if (!url) return;
        setIsLoading(true);
        setError(null);
        setData(null);

        const controller = new AbortController();
        const { signal } = controller;

        fetchWithTimeout(url, {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                'User-Agent': getSingBoxUserAgent(),
            },
            signal,
        })
            .then(async (response) => {
                if (signal.aborted) return;
                if (response.ok) {
                    const content = await response.text();
                    if (signal.aborted) return;
                    setData(content);

                    const { upload, download, total, expire } = parseProfileUserinfo(
                        response.headers.get('subscription-userinfo')
                    );

                    const name =
                        getRemoteNameByContentDisposition(response.headers.get('content-disposition') ?? '')
                        ?? ProfileStore.findByUrl(url)?.name
                        ?? urlHostname(url, 'Profile');

                    ProfileStore.upsertByUrl({
                        name,
                        url,
                        usedTraffic: upload + download,
                        totalTraffic: total,
                        expireTime: expire,
                        configContent: content,
                    });
                    setExtraInfo({ upload, download, total, expire });
                    notifySuccess();
                } else {
                    if (signal.aborted) return;
                    const err = new Error(i18n.t('config_error_status', { code: response.status }));
                    setError(err);
                    notifyError();
                }
            })
            .catch((fetchError: Error) => {
                if (signal.aborted) return;
                setError(fetchError);
                notifyError();
            })
            .finally(() => {
                if (signal.aborted) return;
                setIsLoading(false);
            });

        return () => {
            controller.abort();
        };
    }, [url]);

    return { data, error, isLoading, extraInfo };
}

// ─── Shared: Icon Orb ───────────────────────────────────────
function IconOrb({
    name,
    color,
    tint,
}: {
    name: keyof typeof Ionicons.glyphMap;
    color: string;
    tint: string;
}) {
    return (
        <View
            style={{
                width: 76,
                height: 76,
                borderRadius: 38,
                backgroundColor: tint,
                alignItems: 'center',
                justifyContent: 'center',
            }}
        >
            <Ionicons name={name} size={36} color={color} />
        </View>
    );
}

// ─── Loading State ──────────────────────────────────────────
function LoadingView() {
    const theme = useTheme();
    return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}>
            <IconOrb name="cloud-download-outline" color="#007AFF" tint="#007AFF18" />
            <Text style={{ fontSize: 17, fontWeight: '600', fontFamily: Fonts?.rounded, color: theme.text, marginTop: 20, letterSpacing: -0.4, lineHeight: 24 }}>
                {i18n.t('config_downloading')}
            </Text>
            <Text style={{ fontSize: 15, color: theme.textSecondary, marginTop: 6 }}>
                {i18n.t('config_please_wait')}
            </Text>
            <ActivityIndicator size="large" color="#007AFF" style={{ marginTop: 32 }} />
        </View>
    );
}

// ─── Error State ────────────────────────────────────────────
function ErrorView({ message }: { message: string }) {
    const theme = useTheme();
    return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, backgroundColor: theme.background }}>
            <IconOrb name="alert-circle" color="#FF3B30" tint="#FF3B3015" />
            <Text style={{ fontSize: 17, fontWeight: '600', fontFamily: Fonts?.rounded, color: theme.text, marginTop: 20, letterSpacing: -0.4, lineHeight: 24 }}>
                {i18n.t('config_download_failed_title')}
            </Text>
            <Text style={{ fontSize: 15, color: theme.textSecondary, marginTop: 6, textAlign: 'center' }}>
                {i18n.t('config_download_failed_hint')}
            </Text>
            <View
                style={{
                    width: '100%',
                    maxWidth: 360,
                    marginTop: 20,
                    borderRadius: 14,
                    backgroundColor: theme.cardBackground,
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                }}
            >
                <ScrollView style={{ maxHeight: 110 }} showsVerticalScrollIndicator={false}>
                    <Text style={{ fontSize: 13, color: '#FF3B30', lineHeight: 19, fontFamily: Fonts?.mono }}>
                        {message}
                    </Text>
                </ScrollView>
            </View>
            <Pressable
                onPress={() => { mediumImpact(); router.back(); }}
                style={({ pressed }) => ({
                    marginTop: 24,
                    minWidth: 120,
                    alignItems: 'center',
                    paddingHorizontal: 32,
                    paddingVertical: 13,
                    borderRadius: 100,
                    backgroundColor: theme.backgroundElement,
                    opacity: pressed ? 0.55 : 1,
                })}
                hitSlop={8}
            >
                <Text style={{ fontSize: 15, fontWeight: '500', color: theme.text }}>{i18n.t('back')}</Text>
            </Pressable>
        </View>
    );
}

// ─── Success State ──────────────────────────────────────────
function InfoRow({
    label,
    value,
    theme,
    isLast,
}: {
    label: string;
    value: string;
    theme: ReturnType<typeof useTheme>;
    isLast?: boolean;
}) {
    return (
        <View
            style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingVertical: 13,
                borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
                borderBottomColor: theme.border,
            }}
        >
            <Text style={{ fontSize: 15, color: theme.textSecondary }}>{label}</Text>
            <Text style={{ fontSize: 15, fontWeight: '500', color: theme.text }}>{value}</Text>
        </View>
    );
}

function SuccessView({
    extraInfo,
}: {
    extraInfo: { upload: number; download: number; total: number; expire: number } | null;
}) {
    const theme = useTheme();
    const used = extraInfo ? extraInfo.upload + extraInfo.download : 0;
    const total = extraInfo ? extraInfo.total : 0;
    const expireDate = extraInfo && extraInfo.expire > 0 ? new Date(extraInfo.expire * 1000) : null;
    const left = total > used ? total - used : 0;
    const usedPercent = total > 0 ? Math.min((used / total) * 100, 100) : 0;
    const isNearLimit = usedPercent > 85;

    return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, backgroundColor: theme.background }}>
            <IconOrb name="checkmark-circle" color="#34C759" tint="#34C75915" />
            <Text style={{ fontSize: 17, fontWeight: '600', fontFamily: Fonts?.rounded, color: theme.text, marginTop: 20, letterSpacing: -0.4, lineHeight: 24 }}>
                {i18n.t('config_import_success_title')}
            </Text>
            <Text style={{ fontSize: 15, color: theme.textSecondary, marginTop: 6 }}>
                {i18n.t('config_import_success_hint')}
            </Text>

            {/* Info card */}
            <View
                style={{
                    width: '100%',
                    maxWidth: 360,
                    marginTop: 28,
                    borderRadius: 16,
                    backgroundColor: theme.cardBackground,
                    paddingHorizontal: 16,
                    overflow: 'hidden',
                }}
            >
                {/* Traffic section */}
                {total > 0 && (
                    <View style={{ paddingTop: 14, paddingBottom: 4 }}>
                        {/* Label row */}
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                            <Text style={{ fontSize: 13, fontWeight: '500', color: theme.textSecondary }}>
                                {i18n.t('config_traffic_label')}
                            </Text>
                            <Text style={{ fontSize: 13, fontWeight: '600', color: isNearLimit ? '#FF3B30' : theme.text }}>
                                {i18n.t('config_traffic_remaining', { amount: fmtBytes(left) })}
                            </Text>
                        </View>
                        {/* Progress track */}
                        <View style={{ width: '100%', height: 6, borderRadius: 3, backgroundColor: theme.backgroundElement }}>
                            <View
                                style={{
                                    height: 6,
                                    borderRadius: 3,
                                    width: `${usedPercent}%`,
                                    backgroundColor: isNearLimit ? '#FF3B30' : '#007AFF',
                                }}
                            />
                        </View>
                        {/* Sub labels */}
                        <View
                            style={{
                                flexDirection: 'row',
                                justifyContent: 'space-between',
                                marginTop: 8,
                                paddingBottom: 13,
                                borderBottomWidth: StyleSheet.hairlineWidth,
                                borderBottomColor: theme.border,
                            }}
                        >
                            <Text style={{ fontSize: 12, color: theme.textSecondary }}>
                                {i18n.t('config_traffic_used_label', { amount: fmtBytes(used), percent: usedPercent.toFixed(1) })}
                            </Text>
                            <Text style={{ fontSize: 12, color: theme.textSecondary }}>
                                {i18n.t('config_traffic_total_label', { amount: fmtBytes(total) })}
                            </Text>
                        </View>
                    </View>
                )}

                {/* Expire row */}
                <InfoRow
                    label={i18n.t('expire_time')}
                    value={expireDate ? expireDate.toLocaleDateString() : i18n.t('config_no_expire')}
                    theme={theme}
                    isLast
                />
            </View>

            {/* CTA */}
            <Pressable
                onPress={() => { mediumImpact(); router.dismissTo('/'); }}
                style={({ pressed }) => ({
                    marginTop: 32,
                    width: '100%',
                    maxWidth: 360,
                    alignItems: 'center',
                    paddingVertical: 16,
                    borderRadius: 14,
                    backgroundColor: '#007AFF',
                    opacity: pressed ? 0.72 : 1,
                })}
            >
                <Text style={{ color: '#ffffff', fontSize: 17, fontWeight: '600', letterSpacing: -0.3, fontFamily: Fonts?.rounded, lineHeight: 24 }}>
                    {i18n.t('config_get_started')}
                </Text>
            </Pressable>
        </View>
    );
}

// ─── Default / No URL State ─────────────────────────────────
function DefaultView() {
    const theme = useTheme();
    return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}>
            <IconOrb name="link-outline" color={theme.textSecondary} tint={theme.backgroundElement} />
            <Text style={{ fontSize: 15, color: theme.textSecondary, marginTop: 16, textAlign: 'center' }}>
                {i18n.t('config_deep_link_hint')}
            </Text>
        </View>
    );
}

// ─────────────────────────────────────────────────────────────
// Config Import Screen
// ─────────────────────────────────────────────────────────────

export default function ConfigScreen() {
    const theme = useTheme();
    const { data: deepLinkData, apply } = useLocalSearchParams<{ data: string; apply?: string }>();
    const shouldApply = apply === '1';

    let decodedUrl: string | undefined;
    if (deepLinkData) {
        try {
            decodedUrl = atob(deepLinkData);
            if (!decodedUrl.startsWith('https://')) decodedUrl = undefined;
        } catch {
            decodedUrl = undefined;
        }
    }

    // When apply=1 and VPN is running, we must stop the VPN first before downloading.
    // `downloadUrl` is only set (triggering the fetch) once any required stop is complete.
    const [downloadUrl, setDownloadUrl] = useState<string | undefined>(undefined);
    const [isStopping, setIsStopping] = useState(false);
    const stopInitiatedRef = useRef(false);

    useEffect(() => {
        if (!decodedUrl) return;
        if (!shouldApply) {
            setDownloadUrl(decodedUrl);
            return;
        }
        // shouldApply: stop VPN first, wait for STOPPED event, then trigger download
        if (stopInitiatedRef.current) return;
        stopInitiatedRef.current = true;

        const currentStatus = ExpoOneBox.getStatus();
        if (currentStatus === VPN_STATUS.STARTED || currentStatus === VPN_STATUS.STARTING) {
            let resolved = false;
            setIsStopping(true);

            const STOP_TIMEOUT_MS = 10000;

            const proceed = () => {
                if (resolved) return;
                resolved = true;
                clearTimeout(timeoutId);
                statusListener.remove();
                setIsStopping(false);
                setDownloadUrl(decodedUrl);
            };

            // Wait for native STOPPED status — stop() resolves when the command is sent,
            // not when the VPN tunnel is fully torn down.
            const statusListener = ExpoOneBox.addListener('onStatusChange', (event) => {
                if (event.status === VPN_STATUS.STOPPED) proceed();
            });

            const timeoutId = setTimeout(() => {
                console.warn('[Config] VPN stop wait timeout — proceeding with download');
                proceed();
            }, STOP_TIMEOUT_MS);

            ExpoOneBox.stop().catch(() => {
                // stop() rejected (e.g. already stopped) — proceed after brief delay
                setTimeout(proceed, 300);
            });

            return () => {
                resolved = true;
                clearTimeout(timeoutId);
                statusListener.remove();
            };
        } else {
            setDownloadUrl(decodedUrl);
        }
    // decodedUrl and shouldApply are derived from route params and never change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const { data, error, isLoading, extraInfo } = useDownloadConfig(downloadUrl);

    const [isApplying, setIsApplying] = useState(false);
    const appliedRef = useRef(false);

    useEffect(() => {
        if (!data || !shouldApply || appliedRef.current) return;
        appliedRef.current = true;

        let cancelled = false;

        async function startAfterImport() {
            setIsApplying(true);
            try {
                if (Platform.OS === 'android') {
                    const hasPermission = await ExpoOneBox.checkVpnPermission();
                    if (!hasPermission) {
                        const granted = await ExpoOneBox.requestVpnPermission();
                        if (!granted) {
                            Alert.alert(i18n.t('insufficient_permission'), i18n.t('permission_required'));
                            return;
                        }
                    }
                }
                if (cancelled) return;

                const processedConfig = await getProcessedConfig();
                await ExpoOneBox.start(processedConfig);

                if (cancelled) return;
                router.dismissTo('/');
            } catch (e: unknown) {
                if (cancelled) return;
                const msg = e instanceof Error ? e.message : i18n.t('operation_failed');
                Alert.alert(i18n.t('error'), msg);
            } finally {
                if (!cancelled) setIsApplying(false);
            }
        }

        startAfterImport();

        return () => { cancelled = true; };
    }, [data, shouldApply]);

    // When apply=1, keep showing loading until navigation fires (covers the gap
    // between isLoading→false and isApplying→true across the effect render cycle)
    const busy = isStopping || isLoading || isApplying || (shouldApply && !!data);

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
            {/* Navigation bar — standard iOS inline title style */}
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, minHeight: 44 }}>
                <Pressable
                    onPress={() => router.back()}
                    style={({ pressed }) => ({
                        width: 44,
                        height: 44,
                        borderRadius: 22,
                        alignItems: 'center',
                        justifyContent: 'center',
                        opacity: pressed ? 0.55 : 1,
                    })}
                    hitSlop={8}
                >
                    <Ionicons name="chevron-back" size={22} color="#007AFF" />
                </Pressable>
                <Text
                    numberOfLines={1}
                    style={{
                        flex: 1,
                        textAlign: 'center',
                        fontSize: 17,
                        fontWeight: '600',
                        color: theme.text,
                        marginHorizontal: 8,
                        fontFamily: Fonts?.sans,
                    }}
                >
                    {i18n.t('import_subscription')}
                </Text>
                {/* Spacer to balance back button */}
                <View style={{ width: 44 }} />
            </View>

            {/* Content states */}
            {busy && <LoadingView />}
            {!busy && error && <ErrorView message={error.message} />}
            {!busy && !error && data && !shouldApply && <SuccessView extraInfo={extraInfo} />}
            {!busy && !error && !data && <DefaultView />}
        </SafeAreaView>
    );
}
