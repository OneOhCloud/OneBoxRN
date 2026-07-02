/**
 * ExpoOneBox → VpnBridge adapter. The only file in src/contexts/vpn/
 * that touches the native module; everything else takes the injected
 * interface so the pure cores stay node-testable.
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
