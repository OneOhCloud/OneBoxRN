/**
 * import-flow machine（import-flow-machine.ts）之上的 React 适配器。
 *
 * 持有非纯接线 —— context action、原生 fetch bridge、配置存储、流程日志、
 * haptics —— 以及纯核心不应知晓的两项呈现关切：把类型化的 ImportError
 * 映射到 i18n 字符串，并在 applied 阶段到达后导航回 home。
 */
import { notifyError, notifySuccess } from '@/components/ui/haptics';
import i18n from '@/constants/language';
import { useVpn } from '@/contexts/vpn-context';
import type { StartFailure } from '@/contexts/vpn/types';
import { ProfileStore } from '@/database/kv';
import ExpoOneBox from '@/modules/expo-onebox';
import { getSingBoxUserAgent } from '@/utils';
import { verifyHostname } from '@/utils/domain-verification';
import { registerConfigRefreshTask } from '@/tasks/config-refresh';
import { logFlowEvent, recordFlowFailure } from '@/utils/flow-log';
import { jsLog } from '@/utils/log-sink';
import { router } from 'expo-router';
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
    createImportFlowMachine,
    type ImportError,
    type ImportPhase,
} from './import-flow-machine';

/**
 * 把类型化的 context-start 失败映射到本屏的用户可见消息（下面包进
 * `config_apply_failed`）。'aborted' 绝不会到达这里 —— machine 在阶段
 * 边界就将其丢弃。
 */
function mapStartFailureMessage(failure: Exclude<StartFailure, { kind: 'aborted' }>): string {
    switch (failure.kind) {
        case 'permission-denied':
            return i18n.t('config_permission_denied');
        case 'timeout':
            return i18n.t('config_apply_timeout', { seconds: failure.timeoutMs / 1000 });
        case 'config-error':
        case 'native-error':
            return failure.message;
    }
}

function mapImportError(error: ImportError): string {
    switch (error.kind) {
        case 'verify-failed':
            return i18n.t('config_verify_failed', { message: error.message });
        case 'download-http':
            return i18n.t('config_error_status', { code: error.statusCode });
        case 'download-network':
            return error.message;
        case 'invalid-content':
            return i18n.t('config_invalid_content', { reason: error.reason });
        case 'start-failed':
            return i18n.t('config_apply_failed', { message: mapStartFailureMessage(error.failure) });
    }
}

export interface ImportFlowView {
    phase: ImportPhase;
    /** phase 为 'error' 时预先本地化的消息；否则为 null。 */
    errorMessage: string | null;
}

export function useImportFlow(input: { data?: string; apply?: string }): ImportFlowView {
    const { start, stop } = useVpn();

    // 每个屏幕实例一个 machine；路由参数不会原地变更。start/stop 是模块级
    // action 单例（身份稳定），因此在惰性初始化中捕获它们是安全的。
    const [machine] = useState(() =>
        createImportFlowMachine(
            { data: input.data, apply: input.apply },
            {
                verifyHostname,
                stop,
                start,
                fetchConfig: (url, userAgent) => ExpoOneBox.fetchProfileConfig(url, userAgent),
                userAgent: getSingBoxUserAgent(),
                profiles: ProfileStore,
                onActiveProfileChanged: () => { void registerConfigRefreshTask(); },
                logFlowEvent,
                recordFlowFailure,
                haptics: { notifySuccess, notifyError },
                log: jsLog,
            },
        ),
    );

    useEffect(() => {
        machine.run();
        return () => machine.cancel();
    }, [machine]);

    const phase = useSyncExternalStore(machine.subscribe, machine.getSnapshot, machine.getSnapshot);

    useEffect(() => {
        if (phase.phase !== 'applied') return;
        jsLog.info('[Config] apply: success → router.dismissTo("/")');
        router.dismissTo('/');
    }, [phase]);

    return {
        phase,
        errorMessage: phase.phase === 'error' ? mapImportError(phase.error) : null,
    };
}
