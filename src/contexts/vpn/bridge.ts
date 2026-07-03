/**
 * ExpoOneBox → VpnBridge 适配器。src/contexts/vpn/ 下唯一触碰原生模块的
 * 文件；其余都接收注入的接口，使纯核心保持可在 node 下测试。
 */

import ExpoOneBox from '@/modules/expo-onebox';
import type { VpnBridge } from './types';

export const expoOneBoxBridge: VpnBridge = {
    getStatus: () => ExpoOneBox.getStatus(),
    start: (config) => ExpoOneBox.start(config),
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
