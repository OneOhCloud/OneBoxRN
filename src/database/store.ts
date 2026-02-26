
import { ALLOWLAN_STORE_KEY, configType, ENABLE_BYPASS_ROUTER_STORE_KEY, ENABLE_TUN_STORE_KEY, SING_BOX_MAJOR_VERSION, SING_BOX_VERSION, STAGE_VERSION_STORE_KEY, StageVersionType, USE_DHCP_STORE_KEY, USER_AGENT_STORE_KEY } from '@/definition';
import { MMKVStore } from './kv';

export const LANGUAGE_STORE_KEY = 'language';
export const CLASH_API_SECRET = 'clash_api_secret_key';


// 创建 store 包装器以提供统一的 get/set 接口
const storeWrapper = {
    getString: (key: string) => MMKVStore.getString(key),
    getNumber: (key: string) => MMKVStore.getNumber(key),
    getBoolean: (key: string) => MMKVStore.getBoolean(key),
    set: (key: string, value: any) => MMKVStore.set(key, value),
    save: () => Promise.resolve(), // MMKV 不需要显式保存，但为了保持接口一致性，我们提供一个空的 save 方法
    get: async (key: string): Promise<any> => {
        return MMKVStore.getString(key) || MMKVStore.getNumber(key) || MMKVStore.getBoolean(key);
    }
};

const store = storeWrapper;





export const setLanguage = async (language: string) => {
    await setStoreValue(LANGUAGE_STORE_KEY, language);
};


export async function getStoreValue(key: string, defaultValue?: any): Promise<any> {
    let value = await store.get(key);

    // zh: 如果 defaultValue 存在且 value 为 undefined、null 或空字符串，则返回 val
    // en: If defaultValue exists and value is undefined, null, or an empty string, return val
    if (defaultValue && (value === undefined || value === null || value === '')) {
        console.debug(`Store key "${key}" is empty, returning default value.`);
        return defaultValue;
    }
    console.debug(`Store key "${key}" found, returning stored value.`);
    return value;
}
export async function setStoreValue(key: string, value: any) {
    store.set(key, value);
    await store.save();
}


export async function getEnableTun(): Promise<boolean> {
    let b = await store.get(ENABLE_TUN_STORE_KEY);
    return Boolean(b);
}



export async function setEnableTun(value: boolean) {
    store.set(ENABLE_TUN_STORE_KEY, value);
    await store.save();
}
export async function getAllowLan(): Promise<boolean> {
    let b = await store.get(ALLOWLAN_STORE_KEY);
    return Boolean(b);
}

export async function setAllowLan(value: boolean) {
    await store.set(ALLOWLAN_STORE_KEY, value);
    await store.save();
}




/**
 * Retrieves or generates a Clash API secret from the store.
 * 
 * @returns A Promise that resolves to the Clash API secret string.
 * If a secret exists in the store, returns that secret.
 * If no secret exists, generates a new random secret, saves it to the store, and returns it.
 */
export async function getClashApiSecret(): Promise<string> {
    const secret = await store.get(CLASH_API_SECRET);
    if (secret) {
        return secret as string;
    }

    // 生成随机 hex 字符串，优先使用 Web Crypto API，
    // 在 React Native 中尝试动态加载 polyfill（react-native-get-random-values），
    // 若都不可用则退回到 Math.random（不够安全，但可用）。
    async function generateRandomHex(bytes: number): Promise<string> {
        const anyGlobal: any = globalThis;
        const anyCrypto = anyGlobal.crypto;
        if (anyCrypto && typeof anyCrypto.getRandomValues === 'function') {
            const array = new Uint8Array(bytes);
            anyCrypto.getRandomValues(array);
            return Array.from(array).map((b: number) => b.toString(16).padStart(2, '0')).join('');
        }

        // 尝试在 React Native 环境中动态 require 一个 polyfill
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            require('react-native-get-random-values');
            const polyCrypto = (globalThis as any).crypto;
            if (polyCrypto && typeof polyCrypto.getRandomValues === 'function') {
                const array = new Uint8Array(bytes);
                polyCrypto.getRandomValues(array);
                return Array.from(array).map((b: number) => b.toString(16).padStart(2, '0')).join('');
            }
        } catch (e) {
            // ignore
        }

        // 最后的退路：使用 Math.random（不推荐用于高安全场景）
        const arr = new Uint8Array(bytes);
        for (let i = 0; i < bytes; i++) {
            arr[i] = Math.floor(Math.random() * 256);
        }
        return Array.from(arr).map((b: number) => b.toString(16).padStart(2, '0')).join('');
    }

    const randomSecret = await generateRandomHex(12);
    store.set(CLASH_API_SECRET, randomSecret);
    await store.save();
    return randomSecret;
}




export async function isBypassRouterEnabled(): Promise<boolean> {
    let b = await store.get(ENABLE_BYPASS_ROUTER_STORE_KEY);
    return Boolean(b);

}



export async function getUseDHCP(): Promise<boolean> {
    let b = await store.get(USE_DHCP_STORE_KEY);
    if (b === undefined) {
        return false;
    }
    return Boolean(b);
}

export async function setUseDHCP(value: boolean) {
    await store.set(USE_DHCP_STORE_KEY, value);
    await store.save();
}


export async function setCustomRuleSet(key: 'direct' | 'proxy', config: { domain: string[]; domain_suffix: string[]; ip_cidr: string[] }) {
    store.set(`custom_ruleset_${key}`, JSON.stringify(config));
    await store.save();
}

export async function getCustomRuleSet(key: 'direct' | 'proxy'): Promise<{ domain: string[]; domain_suffix: string[]; ip_cidr: string[] }> {
    let s = await store.get(`custom_ruleset_${key}`) as string | undefined;
    if (s) {
        try {
            const config = JSON.parse(s);
            if (config && typeof config === 'object') {
                if (!Array.isArray(config.domain)) {
                    config.domain = [];
                }
                if (!Array.isArray(config.domain_suffix)) {
                    config.domain_suffix = [];
                }
                if (!Array.isArray(config.ip_cidr)) {
                    config.ip_cidr = [];
                }
                return config
            }

        } catch (e) {
            console.error('解析自定义规则集失败:', e);
        }
    }
    return { domain: [], domain_suffix: [], ip_cidr: [] };
}



// set dns for direct connection
export async function setDirectDNS(dnsServers: string) {
    await store.set('direct_dns', dnsServers);
    await store.save();
}

export async function getDirectDNS(): Promise<string> {

    let s = await store.get('direct_dns') as string | undefined;
    if (s) {
        return s;
    }
    // let defaultValue = await invoke('get_optimal_local_dns_server') as string;
    // TODO: 目前先使用阿里公共 DNS 作为默认值，后续可以改为调用 Rust 代码获取最佳 DNS 服务器地址
    let defaultValue = '';
    console.debug('最佳DNS服务器为:', defaultValue);
    return defaultValue || '223.5.5.5';
}

// 获取用户设置的 User Agent
export async function getUserAgent(): Promise<string> {
    const ua = await store.get(USER_AGENT_STORE_KEY) as string | undefined;
    if (ua) {
        return ua;
    }
    return 'default';
}

// 设置 User Agent
export async function setUserAgent(ua: string) {
    await store.set(USER_AGENT_STORE_KEY, ua);
    await store.save();
}

export async function getConfigTemplateURLKey(mode: configType): Promise<string> {
    // zh: 返回配置模版 URL 的存储键，格式为 `key-sing-box-{主版本号}-{模式}-template-path`, 如非必要请勿更改此格式。
    // en: Returns the storage key for the config template URL in the format `key-sing-box-{major-version}-{mode}-template-path`. Do not change this format unless necessary.
    const cacheKey = `key-sing-box-${SING_BOX_MAJOR_VERSION}-${mode}-template-path`;
    return cacheKey;
}

// 读取模版配置源
export async function getConfigTemplateURL(mode: configType): Promise<string> {
    let defaultTemplatePath = '';
    const cacheKey = await getConfigTemplateURLKey(mode);
    defaultTemplatePath = await getDefaultConfigTemplateURL(mode);
    let configPath = await getStoreValue(cacheKey, defaultTemplatePath);
    console.debug(`Config template path for mode "${mode}": ${configPath}`);
    return configPath;
}

export async function setConfigTemplateURL(mode: configType, url: string) {
    const cacheKey = await getConfigTemplateURLKey(mode);
    await setStoreValue(cacheKey, url);
}

export async function getDefaultConfigTemplateURL(mode: configType): Promise<string> {
    const remoteUrl = "https://onebox-updater.oneoh.cloud/conf-template";
    let stageVersion: StageVersionType = await getStoreValue(STAGE_VERSION_STORE_KEY)

    let versionNumber = SING_BOX_VERSION.replace('v', '').split('.')
    let major = versionNumber[0];
    let minor = versionNumber[1];
    let ver = `${major}.${minor}`;

    switch (mode) {
        // case 'mixed-rules':
        //     return `${remoteUrl}/raw/refs/heads/${stageVersion}/conf/${ver}/zh-cn/mixed-rules.jsonc`;
        case 'tun-rules':
            return `${remoteUrl}/raw/refs/heads/${stageVersion}/conf/${ver}/zh-cn/tun-rules.jsonc`;
        // case 'mixed-global':
        //     return `${remoteUrl}/raw/refs/heads/${stageVersion}/conf/${ver}/zh-cn/mixed-global.jsonc`;
        case 'tun-global':
            return `${remoteUrl}/raw/refs/heads/${stageVersion}/conf/${ver}/zh-cn/tun-global.jsonc`;
        default:
            throw new Error(`Unsupported config type: ${mode}`);
    }
}

