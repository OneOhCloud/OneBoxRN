// The runtime sing-box version is NOT hand-maintained here — it comes
// from the linked Libbox binary. SING_BOX_TAG in
// modules/expo-onebox/helper/Makefile is the single build-time source.
// Runtime callers must use `getSingBox{Version,MajorVersion,PatchVersion}()`
// from '@/utils/sing-box-version'.

export type StageVersionType = "stable" | "beta" | "dev";

export type configType = 'tun-rules' | 'tun-global';


export const GITHUB_URL = 'https://github.com/OneOhCloud/OneBox'
export const OFFICIAL_WEBSITE = 'https://sing-box.net'
export const SSI_STORE_KEY = 'selected_profile_identifier'
export const DEVELOPER_TOGGLE_STORE_KEY = 'developer_toggle_key'
export const STAGE_VERSION_STORE_KEY = 'stage_version_key'
export const TUN_STACK_STORE_KEY = 'tun_stack_key'
export const USE_DHCP_STORE_KEY = 'use_dhcp_key'
export const ENABLE_BYPASS_ROUTER_STORE_KEY = 'enable_bypass_router_key'
export const SUPPORT_LOCAL_FILE_STORE_KEY = 'support_local_file_key'
// User Agent 配置键
export const USER_AGENT_STORE_KEY = 'user_agent_key'

// 允许局域网连接
export const ALLOWLAN_STORE_KEY = 'allow_lan_key'
// 是否启用 tun 模式
export const ENABLE_TUN_STORE_KEY = 'enable_tun_key'
// 当前规则模式
export const RULE_MODE_STORE_KEY = 'rule_mode_key'




export type ProfileEntry = {
    id: number
    identifier: string
    name: string
    used_traffic: number
    total_traffic: number
    config_url: string
    official_website: string
    expire_time: number
    last_update_time: number
}

export type ProfileConfig = {
    id: number
    identifier: string
    config_content: string

}