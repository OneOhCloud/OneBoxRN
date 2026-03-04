/**
 * Config Import Screen — downloads and displays subscription configuration.
 * Reached via deep link or QR scan with base64-encoded URL in search params.
 */
import { mediumImpact, notifyError, notifySuccess } from '@/components/ui/haptics';
import { SBConfig } from '@/database/kv';
import { useTheme } from '@/hooks/use-theme';
import { getSingBoxUserAgent } from '@/utils';
import { router, useLocalSearchParams } from 'expo-router';
import { fetch } from 'expo/fetch';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
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

        fetch(url, {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                'User-Agent': getSingBoxUserAgent(),
            },
        })
            .then(async (response) => {
                if (response.ok) {
                    const content = await response.text();
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
                    const err = new Error(`下载配置失败，状态码：${response.status}`);
                    setError(err);
                    notifyError();
                }
            })
            .catch((fetchError: Error) => {
                setError(fetchError);
                notifyError();
            })
            .finally(() => {
                setIsLoading(false);
            });
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

// ─── Loading State ──────────────────────────────────────────
function LoadingView() {
    const theme = useTheme();
    return (
        <View className="flex-1 items-center justify-center" style={{ backgroundColor: theme.background }}>
            <View
                className="w-20 h-20 rounded-full items-center justify-center mb-6"
                style={{ backgroundColor: theme.backgroundElement }}
            >
                <Text className="text-4xl">☁️</Text>
            </View>
            <ActivityIndicator size="large" color="#007AFF" className="mt-6" />
            <Text className="text-lg font-semibold mt-4" style={{ color: theme.text }}>
                正在下载配置…
            </Text>
            <Text className="text-sm mt-2" style={{ color: theme.textSecondary }}>请稍候</Text>
        </View>
    );
}

// ─── Error State ────────────────────────────────────────────
function ErrorView({ message }: { message: string }) {
    const theme = useTheme();
    return (
        <View className="flex-1 items-center justify-center px-6" style={{ backgroundColor: theme.background }}>
            <View
                className="w-20 h-20 rounded-full items-center justify-center mb-6"
                style={{ backgroundColor: '#FF3B3012' }}
            >
                <Text className="text-4xl">⚠️</Text>
            </View>
            <Text className="text-lg font-semibold mt-4" style={{ color: theme.text }}>下载失败</Text>
            <ScrollView
                className="w-full max-w-sm mt-4 rounded-2xl p-4"
                style={{ backgroundColor: theme.backgroundElement }}
            >
                <Text className="text-sm" style={{ color: '#FF3B30' }}>{message}</Text>
            </ScrollView>
            <Pressable
                onPress={() => { mediumImpact(); router.back(); }}
                className="mt-6 px-8 py-3.5 rounded-full active:opacity-80"
                style={{ backgroundColor: theme.backgroundElement }}
            >
                <Text className="text-base font-medium" style={{ color: theme.text }}>返回</Text>
            </Pressable>
        </View>
    );
}

// ─── Success State ──────────────────────────────────────────
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

    return (
        <View className="flex-1 items-center justify-center px-6" style={{ backgroundColor: theme.background }}>
            <View
                className="w-20 h-20 rounded-full items-center justify-center mb-6"
                style={{ backgroundColor: '#34C75912' }}
            >
                <Text className="text-4xl">✅</Text>
            </View>
            <Text className="text-lg font-semibold mt-4" style={{ color: theme.text }}>导入成功</Text>
            <Text className="text-sm mt-2" style={{ color: theme.textSecondary }}>订阅配置已更新</Text>

            {/* Subscription info card */}
            <View
                className="w-full max-w-sm mt-6 rounded-2xl p-5"
                style={{ backgroundColor: theme.backgroundElement }}
            >
                {/* Traffic bar */}
                {total > 0 && (
                    <View className="mb-5">
                        <View className="flex-row justify-between items-center mb-2.5">
                            <Text className="text-sm font-medium" style={{ color: theme.textSecondary }}>
                                剩余流量
                            </Text>
                            <Text className="text-sm font-semibold" style={{ color: theme.text }}>
                                {formatBytes(left)} / {formatBytes(total)}
                            </Text>
                        </View>
                        <View className="w-full h-2 rounded-full" style={{ backgroundColor: theme.background }}>
                            <View
                                className="h-2 rounded-full"
                                style={{
                                    width: `${usedPercent}%`,
                                    backgroundColor: usedPercent > 85 ? '#FF3B30' : '#007AFF',
                                }}
                            />
                        </View>
                        <Text className="text-xs mt-1.5" style={{ color: theme.textSecondary }}>
                            已用 {formatBytes(used)}（{usedPercent.toFixed(1)}%）
                        </Text>
                    </View>
                )}

                {/* Expire date */}
                <View
                    className="flex-row justify-between items-center pt-4"
                    style={{ borderTopWidth: 0.5, borderTopColor: theme.background }}
                >
                    <Text className="text-sm font-medium" style={{ color: theme.textSecondary }}>
                        到期时间
                    </Text>
                    <Text className="text-sm font-semibold" style={{ color: theme.text }}>
                        {expireDate ? expireDate.toLocaleDateString() : '无限制'}
                    </Text>
                </View>
            </View>

            {/* CTA */}
            <Pressable
                onPress={() => { mediumImpact(); router.dismissTo('/'); }}
                className="mt-8 px-10 py-4 rounded-full active:opacity-80"
                style={{ backgroundColor: '#007AFF' }}
            >
                <Text style={{ color: '#ffffff' }} className="text-base font-semibold">开始使用</Text>
            </Pressable>
        </View>
    );
}

// ─── Default / No URL State ─────────────────────────────────
function DefaultView() {
    const theme = useTheme();
    return (
        <View className="flex-1 items-center justify-center" style={{ backgroundColor: theme.background }}>
            <Text className="text-lg font-semibold" style={{ color: theme.textSecondary }}>
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
        <SafeAreaView className="flex-1" style={{ flex: 1, backgroundColor: theme.background }}>
            {/* Back button overlay */}
            <View className="absolute top-14 left-4 z-10">
                <Pressable
                    onPress={() => router.back()}
                    className="w-10 h-10 rounded-full items-center justify-center active:opacity-70"
                    style={{ backgroundColor: theme.backgroundElement }}
                >
                    <Text style={{ color: theme.text, fontSize: 18 }}>‹</Text>
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
