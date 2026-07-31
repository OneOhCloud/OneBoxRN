/**
 * 仅供开发的自动化 harness。经 deep link 进入
 *   oneoh-networktools://dev-harness?op=<op>&tag=<tag>
 * 通过 adb 触发（`adb shell am start -a android.intent.action.VIEW -d '<url>'`）。
 *
 * 在不触碰生产 UI 的情况下驱动 VpnContext 动作，并为每个动作向 logcat
 * 输出一行机器可解析日志（tag `ReactNativeJS`）：
 *   [[HARNESS]] op=<op> phase=<start|done|error> key=value …
 * 使验收可仅凭日志驱动与断言 —— 没有盲区。
 *
 * 受 __DEV__ 门控：release 构建下本屏什么都不渲染、也从不派发。
 * 从不作为用户可见内容发布（适用 dev-screens 的 i18n 豁免）。
 */
import { useVpn } from '@/contexts/vpn-context';
import { ProfileConfig } from '@/database/kv';
import ExpoOneBox from '@/modules/expo-onebox';
import { executeConfigRefresh, syncNativeResultToJS } from '@/tasks/config-refresh';
import { getSingBoxUserAgent } from '@/utils';
import { djb2Hash } from '@/utils/log-redact';
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
        // 对同一 op 实例去重 StrictMode 的双重挂载与重复触发。
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
                    case 'test-nodes':
                        // 驱动一轮节点测速；实际是否发出经由 actions 的
                        // `[VPN] URLTest …` 日志断言（STARTED 门禁/节流可观察）。
                        vpn.triggerNodeTests();
                        mark(op, 'done', { status: vpn.status });
                        break;
                    case 'refresh': {
                        // 手动刷新路径：断言原生结果携带 configUrl（只输出 hash，不打原始 URL）。
                        const r = await executeConfigRefresh();
                        mark(op, 'done', {
                            status: r?.status ?? 'no-url',
                            hasConfigUrl: !!r?.configUrl,
                            configUrlHash: r?.configUrl ? djb2Hash(r.configUrl) : '',
                        });
                        break;
                    }
                    case 'sync-refresh': {
                        // 前台同步路径：显式标记 apply 的写入目标决策。
                        const outcome = syncNativeResultToJS();
                        mark(op, 'done', {
                            kind: outcome.kind,
                            legacy: outcome.kind === 'synced' ? outcome.legacy : '',
                            applyStatus: outcome.kind === 'synced' ? outcome.apply.status : '',
                            targetProfileIdHash: outcome.kind === 'synced' && outcome.apply.status !== 'dropped'
                                ? djb2Hash(outcome.apply.targetProfileId)
                                : '',
                        });
                        break;
                    }
                    case 'fetch': {
                        // 验证该 bridge 方法在运行时可解析。
                        // 网络错误没关系 —— 它证明方法存在
                        //（而非 "fetchProfileConfig is not a function"）。
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
