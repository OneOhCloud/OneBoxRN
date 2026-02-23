import { createMMKV } from 'react-native-mmkv';

export const MMKVStore = createMMKV(
    {
        id: 'oneoh-config-storage',
        encryptionKey: 'oneoh-networktools',
    }
)

export const SBConfig = {
    setConfigLink: (link: string) => {
        MMKVStore.set('configLink', link);
    },
    getConfigLink: () => {
        return MMKVStore.getString('configLink') || '';
    },
    setConfigName: (name: string) => {
        MMKVStore.set('configName', name);
    },
    getConfigName: () => {
        return MMKVStore.getString('configName') || '';
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
        return MMKVStore.getNumber('totalTraffic') || 0;
    },
    setExpireTime: (time: number) => {
        MMKVStore.set('expireTime', time);
    },
    getExpireTime: () => {
        return MMKVStore.getNumber('expireTime') || 0;
    },
    setConfigContent: (content: string) => {
        MMKVStore.set('configContent', content);
    },
    getConfigContent: () => {
        return MMKVStore.getString('configContent') || '';
    },
}