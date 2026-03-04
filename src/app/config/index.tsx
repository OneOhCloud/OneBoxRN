/**
 * Config Import Screen — downloads and displays subscription configuration.
 * Reached via deep link or QR scan with base64-encoded URL in search params.
 */
import { mediumImpact, notifyError, notifySuccess } from '@/components/ui/haptics';
import { SBConfig } from '@/database/kv';
import { useTheme } from '@/hooks/use-theme';
import { getSingBoxUserAgent } from '@/utils';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { fetch } from 'expo/fetch';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// ─── Download Hook ──────────────────────────────────────────
/** Fetches subscription config from URL and persists to MMKV */
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

        fetch(url, {
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

                    const subscriptionUserinfo = response.headers.get('subscription-userinfo');
                    const uploadMatch = subscriptionUserinfo?.match(/upload=(\d+)/);
                    const downloadMatch = subscriptionUserinfo?.match(/download=(\d+)/);
                    const totalMatch = subscriptionUserinfo?.match(/total=(\d+)/);
                    const expireMatch = subscriptionUserinfo?.match(/expire=(\d+)/);

                    const upload = uploadMatch ? parseInt(uploadMatch[1]) : 0;
                    const download = downloadMatch ? parseInt(downloadMatch[1]) : 0;
                    const total = totalMatch ? parseInt(totalMatch[1]) : 0;
                    const expire = expireMatch ? parseInt(expireMatch[1]) : 0;

                    SBConfig.setUsedTraffic(upload + download);
                    SBConfig.setTotalTraffic(total);
                    SBConfig.setExpireTime(expire);
                    SBConfig.setConfigLink(url);
                    SBConfig.setConfigContent(content);
                    setExtraInfo({ upload, download, total, expire });
                    notifySuccess();
                } else {
                    if (signal.aborted) return;
                    const err = new Error(`下载配置失败，状态码：${response.status}`);
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

// ─── Byte Formatter ─────────────────────────────────────────
function formatBytes(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
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
                width: 72,
                height: 72,
                borderRadius: 36,
                backgroundColor: tint,
                alignItems: 'center',
                justifyContent: 'center',
            }}
        >
            <Ionicons name={name} size={34} color={color} />
        </View>
    );
}

// ─── Loading State ──────────────────────────────────────────
function LoadingView() {
    const theme = useTheme();
    return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}>
            <IconOrb name="cloud-download-outline" color="#007AFF" tint="#007AFF18" />
            <Text style={{ fontSize: 17, fontWeight: '600', color: theme.text, marginTop: 20, letterSpacing: -0.3 }}>
                正在下载配置
            </Text>
            <Text style={{ fontSize: 14, color: theme.textSecondary, marginTop: 6 }}>请稍候</Text>
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
            <Text style={{ fontSize: 17, fontWeight: '600', color: theme.text, marginTop: 20, letterSpacing: -0.3 }}>
                下载失败
            </Text>
            <Text style={{ fontSize: 14, color: theme.textSecondary, marginTop: 6 }}>
                无法获取订阅配置，请检查链接后重试
            </Text>
            <View
                style={{
                    width: '100%',
                    maxWidth: 360,
                    marginTop: 20,
                    borderRadius: 14,
                    backgroundColor: theme.backgroundElement,
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                }}
            >
                <ScrollView style={{ maxHeight: 110 }}>
                    <Text style={{ fontSize: 13, color: '#FF3B30', lineHeight: 19 }}>{message}</Text>
                </ScrollView>
            </View>
            <Pressable
                onPress={() => { mediumImpact(); router.back(); }}
                style={({ pressed }) => ({
                    marginTop: 24,
                    paddingHorizontal: 32,
                    paddingVertical: 13,
                    borderRadius: 100,
                    backgroundColor: theme.backgroundElement,
                    opacity: pressed ? 0.55 : 1,
                })}
            >
                <Text style={{ fontSize: 15, fontWeight: '500', color: theme.text }}>返回</Text>
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
                borderBottomColor: theme.background,
            }}
        >
            <Text style={{ fontSize: 14, color: theme.textSecondary }}>{label}</Text>
            <Text style={{ fontSize: 14, fontWeight: '600', color: theme.text }}>{value}</Text>
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
            <Text style={{ fontSize: 17, fontWeight: '600', color: theme.text, marginTop: 20, letterSpacing: -0.3 }}>
                导入成功
            </Text>
            <Text style={{ fontSize: 14, color: theme.textSecondary, marginTop: 6 }}>
                订阅配置已更新
            </Text>

            {/* Info card */}
            <View
                style={{
                    width: '100%',
                    maxWidth: 360,
                    marginTop: 24,
                    borderRadius: 16,
                    backgroundColor: theme.backgroundElement,
                    paddingHorizontal: 16,
                    overflow: 'hidden',
                }}
            >
                {/* Traffic section */}
                {total > 0 && (
                    <View style={{ paddingTop: 14, paddingBottom: 2 }}>
                        {/* Label row */}
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                            <Text style={{ fontSize: 13, color: theme.textSecondary }}>流量使用</Text>
                            <Text style={{ fontSize: 13, fontWeight: '600', color: theme.text }}>
                                {formatBytes(left)} 剩余
                            </Text>
                        </View>
                        {/* Progress track */}
                        <View style={{ width: '100%', height: 5, borderRadius: 3, backgroundColor: theme.background }}>
                            <View
                                style={{
                                    height: 5,
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
                                marginTop: 7,
                                paddingBottom: 13,
                                borderBottomWidth: StyleSheet.hairlineWidth,
                                borderBottomColor: theme.background,
                            }}
                        >
                            <Text style={{ fontSize: 12, color: theme.textSecondary }}>
                                已用 {formatBytes(used)}（{usedPercent.toFixed(1)}%）
                            </Text>
                            <Text style={{ fontSize: 12, color: theme.textSecondary }}>
                                共 {formatBytes(total)}
                            </Text>
                        </View>
                    </View>
                )}

                {/* Expire row */}
                <InfoRow
                    label="到期时间"
                    value={expireDate ? expireDate.toLocaleDateString('zh-CN') : '无限制'}
                    theme={theme}
                    isLast
                />
            </View>

            {/* CTA */}
            <Pressable
                onPress={() => { mediumImpact(); router.dismissTo('/'); }}
                style={({ pressed }) => ({
                    marginTop: 28,
                    paddingHorizontal: 40,
                    paddingVertical: 15,
                    borderRadius: 100,
                    backgroundColor: '#007AFF',
                    opacity: pressed ? 0.72 : 1,
                })}
            >
                <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '600', letterSpacing: -0.2 }}>
                    开始使用
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
            <Text style={{ fontSize: 15, color: theme.textSecondary, marginTop: 16 }}>
                请通过深链导入配置
            </Text>
        </View>
    );
}

// ─────────────────────────────────────────────────────────────
// Config Import Screen
// ─────────────────────────────────────────────────────────────

export default function ConfigScreen() {
    const theme = useTheme();
    const { data: deepLinkData } = useLocalSearchParams<{ data: string }>();

    let url: string | undefined;
    if (deepLinkData) {
        try {
            url = atob(deepLinkData);
            if (!url.startsWith('https://')) url = undefined;
        } catch {
            url = undefined;
        }
    }

    const { data, error, isLoading, extraInfo } = useDownloadConfig(url);

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
            {/* Navigation bar */}
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4 }}>
                <Pressable
                    onPress={() => router.back()}
                    style={({ pressed }) => ({
                        width: 36,
                        height: 36,
                        borderRadius: 18,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: theme.backgroundElement,
                        opacity: pressed ? 0.55 : 1,
                    })}
                >
                    <Ionicons name="chevron-back" size={20} color={theme.text} />
                </Pressable>
            </View>

            {/* Content states */}
            {isLoading && <LoadingView />}
            {!isLoading && error && <ErrorView message={error.message} />}
            {!isLoading && !error && data && <SuccessView extraInfo={extraInfo} />}
            {!isLoading && !error && !data && <DefaultView />}
        </SafeAreaView>
    );
}
