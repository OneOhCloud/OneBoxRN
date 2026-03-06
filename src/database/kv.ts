import { configType } from '@/definition';

// 使用 expo 判断是否在 web 环境中，如果是 web 环境则使用 localStorage，否则使用 MMKV 存储
import { Platform } from 'react-native';


import { createMMKV } from 'react-native-mmkv';

let storage: any;
if (Platform.OS === 'web') {
    storage = {
        set: (key: string, value: any) => {
            localStorage.setItem(key, JSON.stringify(value));
        },
        getString: (key: string) => {
            const value = localStorage.getItem(key);
            return value ? JSON.parse(value) : null;
        },
        getNumber: (key: string) => {
            const value = localStorage.getItem(key);
            return value ? Number(JSON.parse(value)) : null;
        },
        getBoolean: (key: string) => {
            const value = localStorage.getItem(key);
            return value ? Boolean(JSON.parse(value)) : null;
        }
    }

} else {
    storage = createMMKV(
        {
            id: 'oneoh-config-storage',
            encryptionKey: 'oneoh-networktools',
        }
    )
}

export const MMKVStore = storage;

export const SBConfig = {
    setConfigLink: (link: string) => {
        MMKVStore.set('configLink', link);
    },
    getConfigLink: () => {
        return MMKVStore.getString('configLink') || 'empty';
    },
    setConfigName: (name: string) => {
        MMKVStore.set('configName', name);
    },
    getConfigName: () => {
        return MMKVStore.getString('configName') || 'default';
    },
    setUsedTraffic: (traffic: number) => {
        MMKVStore.set('usedTraffic', traffic);
    },
    getUsedTraffic: () => {
        return MMKVStore.getNumber('usedTraffic') || 0;
    },
    setTotalTraffic: (traffic: number) => {
        MMKVStore.set('totalTraffic', traffic);
    },
    getTotalTraffic: () => {
        return MMKVStore.getNumber('totalTraffic') || 1;
    },
    setExpireTime: (time: number) => {
        MMKVStore.set('expireTime', time);
    },
    getExpireTime: () => {
        return MMKVStore.getNumber('expireTime') || 0;
    },
    setConfigContent: async (content: string) => {

        MMKVStore.set('configContent', content);
    },
    getConfigContent: () => {
        return MMKVStore.getString('configContent') || '';
    },
    setMode: (mode: configType) => {
        MMKVStore.set('mode', mode);
    },
    getMode: (): configType => {
        return MMKVStore.getString('mode') as configType || 'tun-rules';
    }
}

/**
 * 首次启动标记 — 用于在 app 启动时执行一次性初始化任务：
 * - Android: 申请通知权限、复制 cache.db
 * - iOS:     触发网络权限弹窗、复制 cache.db
 */
export const AppLaunchFlags = {
    isFirstLaunch: (): boolean => {
        return !MMKVStore.getBoolean('firstLaunchDone');
    },
    markFirstLaunchDone: () => {
        MMKVStore.set('firstLaunchDone', true);
    }
}
