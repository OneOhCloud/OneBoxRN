import { getSingBoxUserAgent } from '@/utils';
import { fetchConfigWithFallback } from '@/utils/profile-loader';
import { type SQLiteDatabase } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';

const CONFIG_USER_AGENT = getSingBoxUserAgent()


export interface ProfileEntry {
    id: number;
    identifier: string;
    name: string | null;
    used_traffic: number;
    total_traffic: number;
    config_url: string | null;
    official_website: string | null;
    expire_time: number;
    last_update_time: number;
}

export interface UseProfilesOptions {
    onUpdateSuccess?: (name: string) => void;
    onUpdateAllSuccess?: (count: number) => void;
    onError?: (message: string) => void;
}

export function useProfiles(db: SQLiteDatabase, options?: UseProfilesOptions) {
    const [profiles, setProfiles] = useState<ProfileEntry[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // 加载所有配置
    const loadProfiles = async () => {
        try {
            setIsLoading(true);
            setError(null);
            const result = await db.getAllAsync<ProfileEntry>(
                'SELECT * FROM subscriptions ORDER BY last_update_time DESC'
            );
            setProfiles(result);
        } catch (err) {
            console.error('加载配置失败:', err);
            setError('加载配置失败');
        } finally {
            setIsLoading(false);
        }
    };

    // 组件挂载时加载数据
    useEffect(() => {
        loadProfiles();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 解析配置响应头信息
    const parseConfigInfo = (headers: Headers, configContent: string) => {
        const userinfo = headers.get('subscription-userinfo');
        let usedTraffic = 0;
        let totalTraffic = 1;
        let expireTime = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60; // 默认30天后

        if (userinfo) {
            const parts = userinfo.split(';');
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

    // 创建新配置
    const handleCreate = async (name: string, url: string) => {
        if (!url.trim()) {
            Alert.alert('提示', '请填写配置地址');
            return;
        }

        try {
            const identifier = Date.now().toString(36) + Math.random().toString(36).substr(2);

            const response = await fetchConfigWithFallback(url.trim(), CONFIG_USER_AGENT);
            const configContent = response.content;

            if (!configContent || configContent.trim() === '') {
                throw new Error('配置内容为空');
            }

            const { usedTraffic, totalTraffic, expireTime, officialWebsite } =
                parseConfigInfo(response.headers, configContent);

            const profileName = name.trim() || '未命名配置';

            await db.runAsync(
                `INSERT INTO subscriptions
                    (identifier, name, subscription_url, official_website, used_traffic, total_traffic, expire_time)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
                identifier,
                profileName,
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

            await loadProfiles();
            Alert.alert('成功', '配置已添加');
        } catch (err) {
            console.error('添加配置失败:', err);
            const errorMessage = err instanceof Error ? err.message : '添加配置失败';
            Alert.alert('错误', errorMessage);
        }
    };

    // 更新单个配置
    const handleUpdateProfile = async (identifier: string): Promise<boolean> => {
        try {
            const profile = profiles.find(s => s.identifier === identifier);
            if (!profile || !profile.config_url) {
                throw new Error('配置地址无效');
            }

            const response = await fetchConfigWithFallback(
                profile.config_url,
                CONFIG_USER_AGENT,
            );
            const configContent = response.content;

            if (!configContent || configContent.trim() === '') {
                throw new Error('配置内容为空');
            }

            const { usedTraffic, totalTraffic, expireTime, officialWebsite } =
                parseConfigInfo(response.headers, configContent);

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

            await loadProfiles();

            // 调用成功回调
            options?.onUpdateSuccess?.(profile.name || '未命名配置');
            return true;
        } catch (err) {
            console.error(`更新配置失败 ${identifier}:`, err);
            const errorMessage = err instanceof Error ? err.message : '更新配置失败';
            options?.onError?.(errorMessage);
            return false;
        }
    };

    // 更新所有配置
    const handleUpdateAllProfiles = async () => {
        let successCount = 0;
        for (const item of profiles) {
            try {
                // 直接调用更新逻辑，不触发单个成功回调
                const profile = profiles.find(s => s.identifier === item.identifier);
                if (!profile || !profile.config_url) {
                    continue;
                }

                const response = await fetchConfigWithFallback(
                    profile.config_url,
                    CONFIG_USER_AGENT,
                );
                const configContent = response.content;
                if (!configContent || configContent.trim() === '') {
                    continue;
                }

                const { usedTraffic, totalTraffic, expireTime, officialWebsite } =
                    parseConfigInfo(response.headers, configContent);

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
                console.error(`更新配置失败 ${item.identifier}:`, err);
            }
        }

        await loadProfiles();

        // 调用全部更新成功回调
        if (successCount > 0) {
            options?.onUpdateAllSuccess?.(successCount);
        }
    };

    // 删除配置
    const handleDelete = async (id: number) => {
        Alert.alert(
            '确认删除',
            '确定要删除这个配置吗？',
            [
                { text: '取消', style: 'cancel' },
                {
                    text: '删除',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await db.runAsync('DELETE FROM subscriptions WHERE id = ?', id);
                            await loadProfiles();
                        } catch (err) {
                            console.error('删除配置失败:', err);
                            Alert.alert('错误', '删除配置失败');
                        }
                    }
                }
            ]
        );
    };

    return {
        profiles,
        isLoading,
        error,
        handleCreate,
        handleUpdateProfile,
        handleUpdateAllProfiles,
        handleDelete,
        refreshProfiles: loadProfiles,
    };
}
