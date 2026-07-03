/**
 * DEV-ONLY automation harness. Reached via deep link
 *   oneoh-networktools://dev-harness?op=<op>&tag=<tag>
 * fired over adb (`adb shell am start -a android.intent.action.VIEW -d '<url>'`).
 *
 * Drives VpnContext actions without touching production UI and emits a single
 * machine-parseable line per action to logcat (tag `ReactNativeJS`):
 *   [[HARNESS]] op=<op> phase=<start|done|error> key=value …
 * so acceptance can be driven and asserted from logs alone — no blind spots.
 *
 * Guarded by __DEV__: in a release build the screen renders nothing and never
 * dispatches. Never ships user-visible (dev-screens i18n exemption applies).
 */
import { useVpn } from '@/contexts/vpn-context';
import { ProfileConfig } from '@/database/kv';
import ExpoOneBox from '@/modules/expo-onebox';
import { getSingBoxUserAgent } from '@/utils';
import { jsLog } from '@/utils/log-sink';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Text, View } from 'react-native';

function mark(op: string, phase: string, extra: Record<string, unknown> = {}): void {
    const kv = Object.entries(extra)
        .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
        .join(' ');
    jsLog.info(`[[HARNESS]] op=${op} phase=${phase}${kv ? ' ' + kv : ''}`);
}

export default function DevHarnessScreen() {
    const vpn = useVpn();
    const params = useLocalSearchParams<{ op?: string; tag?: string }>();
    const ranRef = useRef<string | null>(null);

    useEffect(() => {
        if (!__DEV__) return;
        const op = String(params.op ?? 'status');
        // De-dupe StrictMode double-mount + re-fires for the same op instance.
        const runKey = `${op}:${params.tag ?? ''}`;
        if (ranRef.current === runKey) return;
        ranRef.current = runKey;

        (async () => {
            mark(op, 'start', { status: vpn.status, mode: vpn.mode });
            try {
                switch (op) {
                    case 'status':
                        mark(op, 'done', {
                            status: vpn.status,
                            hasActiveProfile: !!ProfileConfig.getConfigLink(),
                            up: vpn.traffic?.uplinkTotal ?? 0,
                            down: vpn.traffic?.downlinkTotal ?? 0,
                        });
                        break;
                    case 'start': {
                        const r = await vpn.start();
                        mark(op, 'done', { ok: r.ok, kind: r.ok ? 'started' : r.failure.kind });
                        break;
                    }
                    case 'stop': {
                        const r = await vpn.stop();
                        mark(op, 'done', { outcome: r.outcome });
                        break;
                    }
                    case 'select': {
                        const tag = String(params.tag ?? 'auto');
                        const r = await vpn.selectNode(tag);
                        mark(op, 'done', { tag, ok: r.ok, message: r.ok ? '' : r.message });
                        break;
                    }
                    case 'restart':
                        vpn.requestRestart();
                        mark(op, 'done', {});
                        break;
                    case 'fetch': {
                        // Verifies the renamed bridge method resolves at runtime.
                        // A network error is fine — it proves the method exists
                        // (vs "fetchProfileConfig is not a function").
                        const url = String(params.tag ?? 'https://example.invalid/config');
                        const r = await ExpoOneBox.fetchProfileConfig(url, getSingBoxUserAgent());
                        mark(op, 'done', { status: r.statusCode, bytes: r.body?.length ?? 0 });
                        break;
                    }
                    default:
                        mark(op, 'error', { reason: 'unknown-op' });
                }
            } catch (e) {
                mark(op, 'error', { message: e instanceof Error ? e.message : String(e) });
            }
        })();
    }, [params.op, params.tag, vpn]);

    if (!__DEV__) return null;
    return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text>dev-harness op={String(params.op ?? 'status')} — see logcat [[HARNESS]]</Text>
        </View>
    );
}
