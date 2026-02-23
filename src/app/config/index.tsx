import { SBConfig } from "@/database/kv";
import { getSingBoxUserAgent } from "@/utils";
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from "expo-router";
import { fetch } from 'expo/fetch';
import { useEffect, useState } from "react";
import { ActivityIndicator, Button, ScrollView, StyleSheet, Text, View } from "react-native";


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
                const err = new Error(`Failed to fetch config content. Status: ${response.status}`);
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

    // 状态视图
    if (isLoading) {
        return (
            <View style={styles.centered}>
                <Ionicons name="cloud-download-outline" size={48} color="#4682B4" style={{ marginBottom: 16 }} />
                <ActivityIndicator size="large" color="#4682B4" />
                <Text style={styles.statusText}>正在下载配置...</Text>
            </View>
        );
    }

    if (error) {
        return (
            <View style={styles.centered}>
                <MaterialIcons name="error-outline" size={48} color="#FF5252" style={{ marginBottom: 16 }} />
                <ScrollView style={styles.errorScroll} contentContainerStyle={{ alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={styles.statusText}>下载失败</Text>
                    <Text style={styles.errorText}>{error.message}</Text>
                </ScrollView>
            </View>
        );
    }

    if (data && extraInfo) {
        // 剩余流量和日期
        const used = extraInfo.upload + extraInfo.download;
        const total = extraInfo.total;
        const expireDate = extraInfo.expire > 0 ? new Date(extraInfo.expire * 1000) : null;
        const left = total > used ? total - used : 0;
        function formatBytes(bytes: number) {
            if (bytes < 1024) return bytes + 'B';
            if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + 'KB';
            if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + 'MB';
            return (bytes / (1024 * 1024 * 1024)).toFixed(2) + 'GB';
        }
        return (
            <View style={styles.centered}>
                <Ionicons name="checkmark-circle-outline" size={48} color="#4CAF50" style={{ marginBottom: 16 }} />
                <Text style={styles.statusText}>导入成功！</Text>
                <View style={styles.infoBox}>
                    <Text style={styles.infoText}>剩余流量：{formatBytes(left)} / {formatBytes(total)}</Text>
                    <Text style={styles.infoText}>已用流量：{formatBytes(used)}</Text>
                    <Text style={styles.infoText}>到期时间：{expireDate ? expireDate.toLocaleString() : '未知'}</Text>
                    {/* 返回主页 */}
                    <Button title="返回主页" onPress={() => {
                        // clear
                        router.dismissTo("/")
                    }} />
                </View>

            </View>
        );
    }

    // 默认视图
    return (
        <View style={styles.centered}>
            <Text style={styles.statusText}>请通过深链导入配置</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    centered: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#F5F6FA',
        padding: 24,
    },
    statusText: {
        fontSize: 18,
        fontWeight: 'bold',
        marginTop: 16,
        color: '#333',
    },
    errorScroll: {
        maxHeight: 120,
        width: '100%',
        marginTop: 8,
        backgroundColor: '#FFF0F0',
        borderRadius: 8,
        padding: 12,
    },
    errorText: {
        color: '#FF5252',
        fontSize: 16,
        marginTop: 8,
    },
    infoBox: {
        marginTop: 24,
        backgroundColor: '#E8F5E9',
        borderRadius: 8,
        padding: 16,
        width: '100%',
        alignItems: 'center',
    },
    infoText: {
        fontSize: 16,
        color: '#333',
        marginBottom: 8,
    },
});
