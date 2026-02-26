import { SBConfig } from "@/database/kv";
import { useTheme } from "@/hooks/use-theme";
import { getSingBoxUserAgent } from "@/utils";
import { router, useLocalSearchParams } from "expo-router";
import { fetch } from 'expo/fetch';
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";


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
            <View style={[styles.centered, { backgroundColor: theme.background }]}>
                <View style={[styles.iconCircle, { backgroundColor: theme.backgroundElement }]}>
                    <Text style={styles.iconEmoji}>☁️</Text>
                </View>
                <ActivityIndicator size="large" color="#007AFF" style={{ marginTop: 24 }} />
                <Text style={[styles.statusText, { color: theme.text }]}>正在下载配置…</Text>
                <Text style={[styles.subText, { color: theme.textSecondary }]}>请稍候</Text>
            </View>
        );
    }

    // ── Error ────────────────────────────────────────────────
    if (error) {
        return (
            <View style={[styles.centered, { backgroundColor: theme.background }]}>
                <View style={[styles.iconCircle, { backgroundColor: '#FF3B3015' }]}>
                    <Text style={styles.iconEmoji}>⚠️</Text>
                </View>
                <Text style={[styles.statusText, { color: theme.text }]}>下载失败</Text>
                <ScrollView style={[styles.errorBox, { backgroundColor: theme.backgroundElement }]}>
                    <Text style={[styles.errorText, { color: '#FF3B30' }]}>{error.message}</Text>
                </ScrollView>
                <TouchableOpacity
                    onPress={() => router.back()}
                    style={[styles.button, { backgroundColor: theme.backgroundElement }]}
                    activeOpacity={0.7}>
                    <Text style={[styles.buttonText, { color: theme.text }]}>返回</Text>
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
            <View style={[styles.centered, { backgroundColor: theme.background }]}>
                <View style={[styles.iconCircle, { backgroundColor: '#34C75915' }]}>
                    <Text style={styles.iconEmoji}>✅</Text>
                </View>
                <Text style={[styles.statusText, { color: theme.text }]}>导入成功</Text>
                <Text style={[styles.subText, { color: theme.textSecondary }]}>订阅配置已更新</Text>

                <View style={[styles.infoCard, { backgroundColor: theme.backgroundElement }]}>
                    {/* Traffic bar */}
                    {total > 0 && (
                        <View style={styles.trafficSection}>
                            <View style={styles.trafficRow}>
                                <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>剩余流量</Text>
                                <Text style={[styles.infoValue, { color: theme.text }]}>
                                    {formatBytes(left)} / {formatBytes(total)}
                                </Text>
                            </View>
                            <View style={[styles.progressBg, { backgroundColor: theme.background }]}>
                                <View
                                    style={[
                                        styles.progressFill,
                                        {
                                            width: `${usedPercent}%` as any,
                                            backgroundColor: usedPercent > 85 ? '#FF3B30' : '#007AFF',
                                        },
                                    ]}
                                />
                            </View>
                            <Text style={[styles.progressHint, { color: theme.textSecondary }]}>
                                已用 {formatBytes(used)}（{usedPercent.toFixed(1)}%）
                            </Text>
                        </View>
                    )}

                    {/* Expire */}
                    <View style={[styles.infoRow, { borderTopColor: theme.background }]}>
                        <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>到期时间</Text>
                        <Text style={[styles.infoValue, { color: theme.text }]}>
                            {expireDate ? expireDate.toLocaleDateString() : '无限制'}
                        </Text>
                    </View>
                </View>

                <TouchableOpacity
                    onPress={() => router.dismissTo('/')}
                    style={[styles.button, styles.buttonPrimary]}
                    activeOpacity={0.8}>
                    <Text style={styles.buttonPrimaryText}>开始使用</Text>
                </TouchableOpacity>
            </View>
        );
    }

    // ── Default ──────────────────────────────────────────────
    return (
        <View style={[styles.centered, { backgroundColor: theme.background }]}>
            <Text style={[styles.statusText, { color: theme.textSecondary }]}>请通过深链导入配置</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    centered: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
    },
    iconCircle: {
        width: 80,
        height: 80,
        borderRadius: 40,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 8,
    },
    iconEmoji: {
        fontSize: 36,
        lineHeight: 44,
    },
    statusText: {
        fontSize: 20,
        fontWeight: '700',
        marginTop: 16,
        textAlign: 'center',
    },
    subText: {
        fontSize: 14,
        marginTop: 6,
        marginBottom: 4,
        textAlign: 'center',
    },
    errorBox: {
        maxHeight: 120,
        width: '100%',
        marginTop: 16,
        borderRadius: 12,
        padding: 12,
    },
    errorText: {
        fontSize: 13,
        lineHeight: 18,
    },
    infoCard: {
        width: '100%',
        marginTop: 24,
        borderRadius: 16,
        overflow: 'hidden',
    },
    trafficSection: {
        padding: 16,
        gap: 8,
    },
    trafficRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    progressBg: {
        height: 6,
        borderRadius: 3,
        overflow: 'hidden',
    },
    progressFill: {
        height: 6,
        borderRadius: 3,
    },
    progressHint: {
        fontSize: 12,
        textAlign: 'right',
    },
    infoRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    infoLabel: {
        fontSize: 14,
    },
    infoValue: {
        fontSize: 14,
        fontWeight: '600',
    },
    button: {
        marginTop: 20,
        width: '100%',
        borderRadius: 14,
        paddingVertical: 14,
        alignItems: 'center',
    },
    buttonText: {
        fontSize: 16,
        fontWeight: '600',
    },
    buttonPrimary: {
        backgroundColor: '#007AFF',
    },
    buttonPrimaryText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
});
