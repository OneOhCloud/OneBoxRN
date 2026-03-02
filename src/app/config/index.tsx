import { SBConfig } from "@/database/kv";
import { useTheme } from "@/hooks/use-theme";
import { getSingBoxUserAgent } from "@/utils";
import { router, useLocalSearchParams } from "expo-router";
import { fetch } from 'expo/fetch';
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from "react-native";


function useDownloadConfig(url: string | undefined) {
    const [data, setData] = useState<string | null>(null);
    const [error, setError] = useState<any>(null);
    const [isLoading, setIsLoading] = useState<boolean>(false);

    useEffect(() => {
        if (!url) return;
        setIsLoading(true);
        setError(null);
        setData(null);
        fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'User-Agent': getSingBoxUserAgent(),
            },
        }).then(async (response) => {
            if (response.ok) {
                let content = await response.text();
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
            } else {
                const err = new Error(`下载配置失败，状态码：${response.status}`);
                setError(err);
            }
        })
            .catch((error) => {
                setError(error);
            })
            .finally(() => {
                setIsLoading(false);
            });
    }, [url]);

    const [extraInfo, setExtraInfo] = useState<{ upload: number, download: number, total: number, expire: number } | null>(null);
    return { data, error, isLoading, extraInfo };
}

export default function Index() {
    const theme = useTheme();
    const { data: deepLinkData } = useLocalSearchParams<{ data: string }>();

    let url: string | undefined = undefined;
    if (deepLinkData) {
        try {
            url = atob(deepLinkData);
            if (!url.startsWith('https://')) url = undefined;
        } catch {
            url = undefined;
        }
    }

    const { data, error, isLoading, extraInfo } = useDownloadConfig(url);

    // ── Loading ──────────────────────────────────────────────
    if (isLoading) {
        return (
            <View className="flex-1 items-center justify-center" style={{ backgroundColor: theme.background }}>
                <View className="w-20 h-20 rounded-full items-center justify-center mb-6" style={{ backgroundColor: theme.backgroundElement }}>
                    <Text className="text-4xl">☁️</Text>
                </View>
                <ActivityIndicator size="large" color="#007AFF" className="mt-6" />
                <Text className="text-lg font-semibold mt-4" style={{ color: theme.text }}>正在下载配置…</Text>
                <Text className="text-sm mt-2" style={{ color: theme.textSecondary }}>请稍候</Text>
            </View>
        );
    }

    // ── Error ────────────────────────────────────────────────
    if (error) {
        return (
            <View className="flex-1 items-center justify-center" style={{ backgroundColor: theme.background }}>
                <View className="w-20 h-20 rounded-full items-center justify-center mb-6" style={{ backgroundColor: '#FF3B3015' }}>
                    <Text className="text-4xl">⚠️</Text>
                </View>
                <Text className="text-lg font-semibold mt-4" style={{ color: theme.text }}>下载失败</Text>
                <ScrollView className="w-full max-w-sm mt-4 rounded-lg p-3" style={{ backgroundColor: theme.backgroundElement }}>
                    <Text className="text-sm" style={{ color: '#FF3B30' }}>{error.message}</Text>
                </ScrollView>
                <TouchableOpacity
                    onPress={() => router.back()}
                    className="mt-4 px-6 py-3 rounded-full"
                    style={{ backgroundColor: theme.backgroundElement }}
                    activeOpacity={0.7}>
                    <Text className="text-base font-medium" style={{ color: theme.text }}>返回</Text>
                </TouchableOpacity>
            </View>
        );
    }

    // ── Success ──────────────────────────────────────────────
    if (data && extraInfo) {
        const used = extraInfo.upload + extraInfo.download;
        const total = extraInfo.total;
        const expireDate = extraInfo.expire > 0 ? new Date(extraInfo.expire * 1000) : null;
        const left = total > used ? total - used : 0;

        function formatBytes(bytes: number) {
            if (bytes < 1024) return bytes + ' B';
            if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
            if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
            return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
        }

        const usedPercent = total > 0 ? Math.min((used / total) * 100, 100) : 0;

        return (
            <View className="flex-1 items-center justify-center" style={{ backgroundColor: theme.background }}>
                <View className="w-20 h-20 rounded-full items-center justify-center mb-6" style={{ backgroundColor: '#34C75915' }}>
                    <Text className="text-4xl">✅</Text>
                </View>
                <Text className="text-lg font-semibold mt-4" style={{ color: theme.text }}>导入成功</Text>
                <Text className="text-sm mt-2" style={{ color: theme.textSecondary }}>订阅配置已更新</Text>

                <View className="w-full max-w-sm mt-6 rounded-xl p-4" style={{ backgroundColor: theme.backgroundElement }}>
                    {/* Traffic bar */}
                    {total > 0 && (
                        <View className="mb-4">
                            <View className="flex-row justify-between items-center mb-2">
                                <Text className="text-sm font-medium" style={{ color: theme.textSecondary }}>剩余流量</Text>
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
                            <Text className="text-xs mt-1" style={{ color: theme.textSecondary }}>
                                已用 {formatBytes(used)}（{usedPercent.toFixed(1)}%）
                            </Text>
                        </View>
                    )}

                    {/* Expire */}
                    <View className="flex-row justify-between items-center pt-4 border-t border-opacity-50" style={{ borderTopColor: theme.background }}>
                        <Text className="text-sm font-medium" style={{ color: theme.textSecondary }}>到期时间</Text>
                        <Text className="text-sm font-semibold" style={{ color: theme.text }}>
                            {expireDate ? expireDate.toLocaleDateString() : '无限制'}
                        </Text>
                    </View>
                </View>

                <TouchableOpacity
                    onPress={() => router.dismissTo('/')}
                    className="mt-6 px-8 py-4 rounded-full"
                    style={{ backgroundColor: '#007AFF' }}
                    activeOpacity={0.8}>
                    <Text className="text-white text-base font-semibold">开始使用</Text>
                </TouchableOpacity>
            </View>
        );
    }

    // ── Default ──────────────────────────────────────────────
    return (
        <View className="flex-1 items-center justify-center" style={{ backgroundColor: theme.background }}>
            <Text className="text-lg font-semibold" style={{ color: theme.textSecondary }}>请通过深链导入配置</Text>
        </View>
    );
}

// ─────────────────────────────────────────────────────────────
// No more styles - using tailwindcss!
// ─────────────────────────────────────────────────────────────
