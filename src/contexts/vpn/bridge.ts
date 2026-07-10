/**
 * ExpoOneBox → VpnBridge 适配器。src/contexts/vpn/ 下唯一触碰原生模块的
 * 文件；其余都接收注入的接口，使纯核心保持可在 node 下测试。
 */

import ExpoOneBox from '@/modules/expo-onebox';
import { jsLog } from '@/utils/log-sink';
import { configFingerprintOf } from '@/utils/startup-diagnostics';
import type { VpnBridge } from './types';

export const expoOneBoxBridge: VpnBridge = {
    getStatus: () => ExpoOneBox.getStatus(),
    start: (config) => {
        // 每次真正下发原生的 start 都留指纹——失败弹窗的日志快照与后续成功
        // 启动可据此比对“是否同一份配置”（间歇性启动失败的排查线索）。
        jsLog.info(`[VPN] start config ${configFingerprintOf(config) ?? '(empty)'}`);
        return ExpoOneBox.start(config);
    },
    stop: () => ExpoOneBox.stop(),
    checkVpnPermission: () => ExpoOneBox.checkVpnPermission(),
    requestVpnPermission: () => ExpoOneBox.requestVpnPermission(),
    selectProxyNode: (tag) => ExpoOneBox.selectProxyNode(tag),
    triggerURLTest: (tag) => ExpoOneBox.triggerURLTest(tag),
    addStatusListener: (cb) => {
        const sub = ExpoOneBox.addListener(
            'onStatusChange',
            (event: { status: number }) => cb(event.status),
        );
        return { remove: () => sub.remove() };
    },
};
