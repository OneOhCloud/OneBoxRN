// import RulesModeTemplate from "@/database/template/zh/rules.jsonc";
import { configType, SING_BOX_MAJOR_VERSION, SING_BOX_VERSION, STAGE_VERSION_STORE_KEY } from "@/definition";
import { ExpoOneBox } from "@/modules/expo-onebox";
import { SBConfig } from "./kv";
import { getCustomRuleSet, getStoreValue, setStoreValue } from "./store";
import TunGlobalConfig from "./template/zh/global";
import TunRulesConfig from "./template/zh/rules";



type Item = {
    tag: string;
    type: string;
}



// 获取订阅列表的 SWR 键
export const GET_SUBSCRIPTIONS_LIST_SWR_KEY = 'get-subscriptions-list'

export interface TerminatedPayload {
    code: number | null;
    signal: number | null;
}

export type StatusChangedPayload = void | TerminatedPayload;


export async function getConfigTemplateCacheKey(mode: configType): Promise<string> {
    const cacheKey = `key-sing-box-${SING_BOX_MAJOR_VERSION}-${mode}-template-config-cache`;
    return cacheKey;
}


type Dict = any;

export async function updateDHCPSettings2Config(newConfig: Dict) {
    for (let i = 0; i < newConfig.dns.servers.length; i++) {
        const server = newConfig.dns.servers[i];
        if (server.tag === "system") {
            let directDNS = await ExpoOneBox.getBestDns()
            await setStoreValue("directDNS", directDNS);
            console.log("当前使用直连 DNS 地址：", directDNS);
            server.type = "udp";
            server.server = directDNS.trim();
            server.server_port = 53;
            console.log("启用 UDP DNS 模式, 服务器地址：", server.server);
        }
    }
}


async function rewriteConfig(newConfig: Dict) {
    newConfig["experimental"]["clash_api"] = {};
    updateDHCPSettings2Config(newConfig);
}

export function getDefaultConfigTemplate(mode: configType, version: string): string {
    if (version.startsWith("v1.12") || version.startsWith("v1.13")) {
        switch (mode) {

            case 'tun-rules':
                return JSON.stringify(TunRulesConfig);
            case 'tun-global':
                return JSON.stringify(TunGlobalConfig);
            default:
                throw new Error(`Unsupported config type: ${mode}`);
        }
    } else {
        alert("Only version 1.12.x and 1.13.x is supported at the moment.")
        throw new Error("Unsupported version")
    }
}


type SBJSONConfig = Map<any, any> & {
    outbounds: any
}

/**
 * 只提取配置文件中的服务器节点配置合并到配置文件中
 */
export async function updateVPNServerConfigFromDB(dbConfigData: SBJSONConfig, newConfig: any): Promise<string> {

    const outboundsSelectorIndex = 1;
    const outboundsUrltestIndex = 2;

    const outbound_groups = newConfig["outbounds"];
    const outboundsSelector = outbound_groups[outboundsSelectorIndex]["outbounds"];
    const outboundsUrltest = outbound_groups[outboundsUrltestIndex]["outbounds"];


    let serverList = dbConfigData.outbounds.filter((item: Item) => {
        // zh: 只找配置文件中的服务器的节点配置
        // en: Only find the node configuration of the server in the configuration file
        let flag = item.type !== "selector" && item.type !== "urltest" && item.type !== "direct" && item.type !== "block";

        // zh: sing-box 1.12 版本开始，dns 类型的节点不再需要
        // en: From sing-box version 1.12, dns type nodes are no longer
        flag = flag && item.type !== "dns";
        return flag;
    });


    for (let i = 0; i < serverList.length; i++) {
        serverList[i]["domain_resolver"] = "system";
        outboundsSelector.push(serverList[i].tag);

    }

    const urltestNameList: string[] = [];
    serverList.forEach((item: any) => {
        urltestNameList.push(item.tag);
    })

    outboundsUrltest.push(...urltestNameList);

    outbound_groups.push(...serverList);
    return JSON.stringify(newConfig);
}



async function getConfigTemplate(mode: configType): Promise<any> {

    // 使用缓存机制来解耦配置模板来源
    // 后面可以灵活更换配置模板的存储位置，比如定期从远程服务器/本地文件获取等方式写入缓存
    const cacheKey = await getConfigTemplateCacheKey(mode);
    let config = await getStoreValue(cacheKey, getDefaultConfigTemplate(mode, SING_BOX_VERSION));
    console.debug(`Fetched config template for mode ${mode} from cache key ${cacheKey}`);
    return JSON.parse(config);
}


export async function getTunConfig(config: string) {
    let configJson = JSON.parse(config)

    const newConfig = await getConfigTemplate('tun-rules');

    // 根据当前的 Stage 版本设置日志等级
    let level = await getStoreValue(STAGE_VERSION_STORE_KEY) === "dev" ? "debug" : "info";
    newConfig.log.level = level;
    console.log("写入[规则]TUN代理配置文件");
    // let dbConfigData = await getSubscriptionConfig(identifier);
    // const appConfigPath = await path.appConfigDir();
    // const dbCacheFilePath = await path.join(appConfigPath, 'tun-cache-rule-v1.db');
    let directCustomRuleSet = await getCustomRuleSet('direct');
    let proxyCustomRuleSet = await getCustomRuleSet('proxy');


    if (directCustomRuleSet) {
        // 找到包含 direct-tag.oneoh.cloud 的规则的坐标，插入自定义规则
        for (let i = 0; i < newConfig.route.rules.length; i++) {
            let rule = newConfig.route.rules[i];
            if (rule.domain && Array.isArray(rule.domain) && rule.domain.includes('direct-tag.oneoh.cloud')) {
                rule.domain.push(...directCustomRuleSet.domain);
                rule.domain_suffix.push(...directCustomRuleSet.domain_suffix);
                rule.ip_cidr.push(...directCustomRuleSet.ip_cidr);
                break;
            }

        }
    }

    if (proxyCustomRuleSet) {
        for (let i = 0; i < newConfig.route.rules.length; i++) {
            let rule = newConfig.route.rules[i];
            if (rule.domain && Array.isArray(rule.domain) && rule.domain.includes('proxy-tag.oneoh.cloud')) {
                rule.domain.push(...proxyCustomRuleSet.domain);
                rule.domain_suffix.push(...proxyCustomRuleSet.domain_suffix);
                rule.ip_cidr.push(...proxyCustomRuleSet.ip_cidr);
                break;
            }
        }
    }

    console.log("当前 TUN Stack:", newConfig.inbounds[0].stack);
    rewriteConfig(newConfig);
    return await updateVPNServerConfigFromDB(configJson, newConfig);
}

export default async function getGlobalTunConfig(config: string) {
    let configJson = JSON.parse(config)
    const newConfig = await getConfigTemplate('tun-global');
    let level = await getStoreValue(STAGE_VERSION_STORE_KEY) === "dev" ? "debug" : "info";
    newConfig.log.level = level;
    rewriteConfig(newConfig);
    return await updateVPNServerConfigFromDB(configJson, newConfig);

}


// 获取经过处理的配置文件
export async function getProcessedConfig(): Promise<string> {
    let mode = SBConfig.getMode();
    let configContent = SBConfig.getConfigContent();
    if (!configContent) {
        throw new Error("No config content found");
    }

    switch (mode) {
        case 'tun-rules':
            return await getTunConfig(configContent);
        case 'tun-global':
            return await getGlobalTunConfig(configContent);
        default:
            throw new Error(`Unsupported config type: ${mode}`);
    }

}
