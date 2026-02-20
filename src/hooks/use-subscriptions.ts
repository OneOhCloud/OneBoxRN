import { type SQLiteDatabase } from 'expo-sqlite';
import { fetch } from 'expo/fetch';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';

export interface Subscription {
    id: number;
    identifier: string;
    name: string | null;
    used_traffic: number;
    total_traffic: number;
    subscription_url: string | null;
    official_website: string | null;
    expire_time: number;
    last_update_time: number;
}

export interface UseSubscriptionsOptions {
    onUpdateSuccess?: (name: string) => void;
    onUpdateAllSuccess?: (count: number) => void;
    onError?: (message: string) => void;
}

export function useSubscriptions(db: SQLiteDatabase, options?: UseSubscriptionsOptions) {
    const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // 加载所有订阅
    const loadSubscriptions = async () => {
        try {
            setIsLoading(true);
            setError(null);
            const result = await db.getAllAsync<Subscription>(
                'SELECT * FROM subscriptions ORDER BY last_update_time DESC'
            );
            setSubscriptions(result);
        } catch (err) {
            console.error('加载订阅失败:', err);
            setError('加载订阅失败');
        } finally {
            setIsLoading(false);
        }
    };

    // 带超时的 fetch 辅助（默认 5000ms）
    const fetchWithTimeout = async (input: string, init?: RequestInit, timeout = 5000) => {
        if (typeof AbortController === 'undefined') {
            return fetch(input, init as any);
        }
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        try {
            // 合并 signal
            const mergedInit = { ...(init || {}), signal: controller.signal } as RequestInit;
            const resp = await fetch(input, mergedInit as any);
            return resp;
        } finally {
            clearTimeout(timeoutId);
        }
    };

    // 组件挂载时加载数据
    useEffect(() => {
        loadSubscriptions();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 解析订阅响应头信息
    const parseSubscriptionInfo = (headers: Headers, configContent: string) => {
        const subscriptionUserinfo = headers.get('subscription-userinfo');
        let usedTraffic = 0;
        let totalTraffic = 1;
        let expireTime = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60; // 默认30天后

        if (subscriptionUserinfo) {
            const parts = subscriptionUserinfo.split(';');
            for (const part of parts) {
                const [key, value] = part.trim().split('=');
                if (key === 'upload' || key === 'download') {
                    usedTraffic += parseInt(value) || 0;
                } else if (key === 'total') {
                    totalTraffic = parseInt(value) || 1;
                } else if (key === 'expire') {
                    expireTime = parseInt(value) || expireTime;
                }
            }
        }

        // 尝试从响应头获取官方网站
        let officialWebsite: string | null = null;
        const profileWebPageUrl = headers.get('profile-web-page-url');
        if (profileWebPageUrl) {
            officialWebsite = profileWebPageUrl;
        }

        return { usedTraffic, totalTraffic, expireTime, officialWebsite };
    };

    // 创建新订阅
    const handleCreate = async (name: string, url: string) => {
        if (!url.trim()) {
            Alert.alert('提示', '请填写订阅地址');
            return;
        }

        try {
            const identifier = Date.now().toString(36) + Math.random().toString(36).substr(2);

            const response = await fetchWithTimeout(url.trim(), {
                method: 'GET',
                headers: {
                    'User-Agent': 'SFM/1.2.19 (macos aarch64 26.2.0; sing-box 1.12.17; language zh-Hans-CN)',
                },
            }, 5000);

            if (!response.ok) {
                throw new Error(`获取订阅失败，HTTP状态码: ${response.status}`);
            }

            const configContent = await response.text();

            if (!configContent || configContent.trim() === '') {
                throw new Error('订阅配置内容为空');
            }

            const { usedTraffic, totalTraffic, expireTime, officialWebsite } =
                parseSubscriptionInfo(response.headers, configContent);

            const subscriptionName = name.trim() || '未命名订阅';

            await db.runAsync(
                `INSERT INTO subscriptions 
                    (identifier, name, subscription_url, official_website, used_traffic, total_traffic, expire_time) 
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
                identifier,
                subscriptionName,
                url.trim(),
                officialWebsite,
                usedTraffic,
                totalTraffic,
                expireTime
            );

            await db.runAsync(
                'INSERT INTO subscription_configs (identifier, config_content) VALUES (?, ?)',
                identifier,
                configContent
            );

            await loadSubscriptions();
            Alert.alert('成功', '订阅已添加');
        } catch (err) {
            console.error('添加订阅失败:', err);
            const errorMessage = err instanceof Error ? err.message : '添加订阅失败';
            Alert.alert('错误', errorMessage);
        }
    };

    // 更新单个订阅
    const handleUpdateSubscription = async (identifier: string): Promise<boolean> => {
        try {
            const subscription = subscriptions.find(s => s.identifier === identifier);
            if (!subscription || !subscription.subscription_url) {
                throw new Error('订阅地址无效');
            }

            const response = await fetchWithTimeout(subscription.subscription_url, {
                method: 'GET',
                headers: {
                    'User-Agent': 'SFM/1.2.19 (macos aarch64 26.2.0; sing-box 1.12.17; language zh-Hans-CN)',
                },
            }, 5000);

            if (!response.ok) {
                throw new Error(`更新订阅失败，HTTP状态码: ${response.status}`);
            }

            const configContent = await response.text();

            if (!configContent || configContent.trim() === '') {
                throw new Error('订阅配置内容为空');
            }

            const { usedTraffic, totalTraffic, expireTime, officialWebsite } =
                parseSubscriptionInfo(response.headers, configContent);

            await db.runAsync(
                `UPDATE subscriptions SET 
                    used_traffic = ?, 
                    total_traffic = ?, 
                    expire_time = ?,
                    official_website = COALESCE(?, official_website),
                    last_update_time = strftime('%s', 'now') 
                WHERE identifier = ?`,
                usedTraffic,
                totalTraffic,
                expireTime,
                officialWebsite,
                identifier
            );

            await db.runAsync(
                'UPDATE subscription_configs SET config_content = ? WHERE identifier = ?',
                configContent,
                identifier
            );

            await loadSubscriptions();

            // 调用成功回调
            options?.onUpdateSuccess?.(subscription.name || '未命名订阅');
            return true;
        } catch (err) {
            console.error(`更新订阅失败 ${identifier}:`, err);
            const errorMessage = err instanceof Error ? err.message : '更新订阅失败';
            options?.onError?.(errorMessage);
            return false;
        }
    };

    // 更新所有订阅
    const handleUpdateAllSubscriptions = async () => {
        let successCount = 0;
        for (const item of subscriptions) {
            try {
                // 直接调用更新逻辑，不触发单个成功回调
                const subscription = subscriptions.find(s => s.identifier === item.identifier);
                if (!subscription || !subscription.subscription_url) {
                    continue;
                }

                const response = await fetchWithTimeout(subscription.subscription_url, {
                    method: 'GET',
                    headers: {
                        'User-Agent': 'SFM/1.2.19 (macos aarch64 26.2.0; sing-box 1.12.17; language zh-Hans-CN)',
                    },
                }, 5000);

                if (!response.ok) {
                    continue;
                }

                const configContent = await response.text();
                if (!configContent || configContent.trim() === '') {
                    continue;
                }

                const { usedTraffic, totalTraffic, expireTime, officialWebsite } =
                    parseSubscriptionInfo(response.headers, configContent);

                await db.runAsync(
                    `UPDATE subscriptions SET 
                        used_traffic = ?, 
                        total_traffic = ?, 
                        expire_time = ?,
                        official_website = COALESCE(?, official_website),
                        last_update_time = strftime('%s', 'now') 
                    WHERE identifier = ?`,
                    usedTraffic,
                    totalTraffic,
                    expireTime,
                    officialWebsite,
                    item.identifier
                );

                await db.runAsync(
                    'UPDATE subscription_configs SET config_content = ? WHERE identifier = ?',
                    configContent,
                    item.identifier
                );

                successCount++;
            } catch (err) {
                console.error(`更新订阅失败 ${item.identifier}:`, err);
            }
        }

        await loadSubscriptions();

        // 调用全部更新成功回调
        if (successCount > 0) {
            options?.onUpdateAllSuccess?.(successCount);
        }
    };

    // 删除订阅
    const handleDelete = async (id: number) => {
        Alert.alert(
            '确认删除',
            '确定要删除这个订阅吗？',
            [
                { text: '取消', style: 'cancel' },
                {
                    text: '删除',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await db.runAsync('DELETE FROM subscriptions WHERE id = ?', id);
                            await loadSubscriptions();
                        } catch (err) {
                            console.error('删除订阅失败:', err);
                            Alert.alert('错误', '删除订阅失败');
                        }
                    }
                }
            ]
        );
    };

    return {
        subscriptions,
        isLoading,
        error,
        handleCreate,
        handleUpdateSubscription,
        handleUpdateAllSubscriptions,
        handleDelete,
        refreshSubscriptions: loadSubscriptions,
    };
}
