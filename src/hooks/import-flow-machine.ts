/**
 * 配置导入流水线 —— 依赖注入的纯状态机。
 *
 * 阶段：capture → verify → stop → download → store → start → apply。
 * 一个 machine 实例跑一次导入；flowId 是闭包字段，盖在每个发出的 FlowEvent
 * 上，因此无需层层传递。UI 适配器（use-import-flow.ts）以 external-store
 * 模式监听，并把类型化错误映射到 i18n 字符串 —— 此处不做呈现。
 *
 * run() 带闩锁：至多执行一条流水线，cancel() 后仍保持闩锁（本 app 不启用
 * React StrictMode，故 effect 只触发一次）。
 */

import type { ProfileStoreApi } from '../database/profile-store-core.ts';
import type { ConfigFetchResult } from '../modules/expo-onebox/src/ExpoOneBox.types.ts';
import type {
    StartFailure,
    StartOptions,
    StartResult,
    StopOptions,
    StopResult,
    VpnLogger,
} from '../contexts/vpn/types.ts';
import { startFailureErrorCode } from '../contexts/vpn/actions.ts';
import {
    classifyFetchError,
    ERROR_CODE_INVALID_CONTENT,
    errorCodeOf,
    validateConfigContent,
} from '../utils/config-fetch-policy.ts';
import { newFlowId, type FlowEvent } from '../utils/flow-events.ts';
import { djb2Hash } from '../utils/log-redact.ts';
import { parseProfileUserinfo, type ProfileTrafficInfo } from '../utils/profile-info.ts';
import { deriveProfileNameFromUrl, getRemoteNameByContentDisposition, urlHostname } from '../utils/url-info.ts';

export type ImportExtraInfo = ProfileTrafficInfo;

export type ImportError =
    | { kind: 'verify-failed'; message: string }
    | { kind: 'download-http'; statusCode: number }
    | { kind: 'download-network'; message: string }
    | { kind: 'invalid-content'; reason: string }
    | { kind: 'start-failed'; failure: Exclude<StartFailure, { kind: 'aborted' }> };

export type ImportPhase =
    | { phase: 'idle' }
    | { phase: 'verifying' }
    | { phase: 'stopping' }
    | { phase: 'downloading'; willApply: boolean }
    | { phase: 'success'; extraInfo: ImportExtraInfo | null }
    | { phase: 'applying' }
    | { phase: 'applied' }
    | { phase: 'error'; error: ImportError };

export interface ImportFlowInput {
    /** 原始 search 参数，与屏幕收到的完全一致。 */
    data: string | undefined;
    apply: string | undefined;
}

export interface ImportFlowDeps {
    /** 主机名 allowlist 校验（@/utils/domain-verification —— 非纯，注入）。 */
    verifyHostname(hostname: string): Promise<boolean>;
    /** Context action —— machine 编排意图，绝不直接调用 bridge。 */
    stop(options?: StopOptions): Promise<StopResult>;
    start(options?: StartOptions): Promise<StartResult>;
    /** 导入流程的原生配置下载（ExpoOneBox.fetchProfileConfig）。 */
    fetchConfig(url: string, userAgent: string): Promise<ConfigFetchResult>;
    userAgent: string;
    profiles: Pick<ProfileStoreApi, 'findByUrl' | 'upsertByUrl'>;
    /**
     * upsertByUrl 会把导入的配置置为活动项 —— 活动项变更后调用（可选），
     * 供调用方重注册后台刷新任务，使原生注册的 URL 跟随活动配置。
     */
    onActiveProfileChanged?(): void;
    logFlowEvent(event: FlowEvent): void;
    recordFlowFailure(event: FlowEvent): void;
    haptics: { notifySuccess(): void; notifyError(): void };
    log: VpnLogger;
    /** 计时时钟；默认 Date.now。 */
    now?(): number;
    /** Base64 解码器；默认全局 atob（Hermes 与 node 均有）。 */
    decodeBase64?(s: string): string;
}

export interface ImportFlowOptions {
    /** apply 路径下载前的 stop-wait 上限。默认 10_000。 */
    stopTimeoutMs?: number;
    /** 自动 apply 启动的挂钟上限。默认 20_000。 */
    startTimeoutMs?: number;
}

export interface ImportFlowMachine {
    getSnapshot(): ImportPhase;
    subscribe(listener: () => void): () => void;
    /** 带闩锁 —— 每个 machine 至多一条流水线。 */
    run(): void;
    /** 丢弃待处理结果，并在阶段边界中止 start。 */
    cancel(): void;
    readonly flowId: string;
}

export function createImportFlowMachine(
    input: ImportFlowInput,
    deps: ImportFlowDeps,
    options?: ImportFlowOptions,
): ImportFlowMachine {
    const now = deps.now ?? Date.now;
    const decodeBase64 = deps.decodeBase64 ?? ((s: string) => atob(s));
    const stopTimeoutMs = options?.stopTimeoutMs ?? 10_000;
    const startTimeoutMs = options?.startTimeoutMs ?? 20_000;

    const flowId = newFlowId();
    const requestedApply = input.apply === '1';

    function setPhase(next: ImportPhase): void {
        deps.log.debug(`[Config] phase: ${phase.phase} → ${next.phase}`);
        phase = next;
        for (const listener of listeners) listener();
    }

    function event(fields: Omit<FlowEvent, 'event' | 'flowId'>): FlowEvent {
        return { event: 'config_import', flowId, ...fields };
    }

    // ── Capture ──────────────────────────────────────────────
    // 解码 deep-link 载荷；仅 https URL 可用。
    function decodePayload(): { url?: string; decodeError: string | null } {
        if (!input.data) return { decodeError: null };
        try {
            const decoded = decodeBase64(input.data);
            if (!decoded.startsWith('https://')) {
                return { decodeError: `decoded but not https (prefix=${decoded.slice(0, 16)})` };
            }
            return { url: decoded, decodeError: null };
        } catch (e) {
            return { decodeError: `atob threw: ${(e as Error).message}` };
        }
    }

    // 在构造时解码，使 INITIAL 快照已反映流水线首个阶段：apply=1 的 deep
    // link 必须在其首个提交帧就渲染 LoadingView，绝不能闪现一帧 DefaultView。
    const decoded = decodePayload();

    let phase: ImportPhase =
        requestedApply && decoded.url ? { phase: 'verifying' } : { phase: 'idle' };
    const listeners = new Set<() => void>();
    let started = false;
    let cancelled = false;
    const startAbort = new AbortController();

    async function runPipeline(): Promise<void> {
        const { url, decodeError } = decoded;

        deps.log.info(
            `[Config] mount: hasData=${!!input.data}, dataBytes=${input.data?.length ?? 0}, apply=${input.apply ?? '(none)'}, requestedApply=${requestedApply}, decodedHost=${url ? urlHostname(url, '(none)') : '(none)'}`
        );
        if (decodeError) {
            deps.log.warn(`[Config] mount: deep link payload rejected → ${decodeError}`);
        }
        deps.logFlowEvent(event({
            phase: 'capture',
            status: decodeError ? 'fail' : 'start',
            detail: `apply=${requestedApply} hasUrl=${!!url}`,
        }));
        if (!url) return; // 保持 idle → DefaultView

        // ── Verify ───────────────────────────────────────────
        // apply=1 仅对验证 allowlist 内的主机名生效；未验证的主机降级为
        // 手动导入。
        let willApply = false;
        if (requestedApply) {
            // 已是初始阶段（见构造时解码）。
            const startedAt = now();
            deps.log.info('[Config] verify: starting hostname allowlist check');
            // 无法解析的 URL → '' → 下面按未验证处理。
            const hostname = urlHostname(url);
            if (!hostname) {
                deps.log.warn('[Config] verify: URL parse failed for decodedUrl → treated as unverified');
            }
            let verified = false;
            try {
                verified = hostname ? await deps.verifyHostname(hostname) : false;
            } catch (err) {
                if (cancelled) return;
                const e = err instanceof Error ? err : new Error(String(err));
                deps.log.error(`[Config] verify failed → ${e.message}`);
                deps.recordFlowFailure(event({
                    phase: 'verify', status: 'fail',
                    errorCode: errorCodeOf(classifyFetchError(e)),
                }));
                setPhase({ phase: 'error', error: { kind: 'verify-failed', message: e.message } });
                return;
            }
            if (cancelled) return;
            deps.log.info(`[Config] verify: done verified=${verified}, elapsedMs=${now() - startedAt} → willApply=${verified}`);
            if (!verified) {
                deps.log.warn('[Config] apply=1 domain not on allowlist, downgrading to manual import');
            }
            deps.logFlowEvent(event({
                phase: 'verify', status: 'ok',
                durationMs: now() - startedAt,
                detail: `verified=${verified}`,
            }));
            willApply = verified;
        }

        // ── Stop ─────────────────────────────────────────────
        // 自动 apply 在下载前必须停止运行中的 tunnel；任何 StopResult 结果
        // 都会继续进入下载。
        if (willApply) {
            setPhase({ phase: 'stopping' });
            const stopStartedAt = now();
            deps.log.info(`[Config] pre-download: willApply → context stop({ timeoutMs: ${stopTimeoutMs} })`);
            const stopResult = await deps.stop({ timeoutMs: stopTimeoutMs });
            if (cancelled) return;
            deps.log.info(`[Config] stop→download handoff: outcome=${stopResult.outcome}, elapsedMs=${now() - stopStartedAt}`);
            deps.logFlowEvent(event({
                phase: 'stop', status: 'ok',
                durationMs: now() - stopStartedAt,
                detail: `outcome=${stopResult.outcome}`,
            }));
        }

        // ── Download ─────────────────────────────────────────
        setPhase({ phase: 'downloading', willApply });
        deps.log.info(`[Config] download start: host=${urlHostname(url, '(unparseable)')}`);
        deps.logFlowEvent(event({ phase: 'download', status: 'start' }));
        const downloadStartedAt = now();

        let response: ConfigFetchResult;
        try {
            response = await deps.fetchConfig(url, deps.userAgent);
        } catch (err) {
            if (cancelled) return;
            const e = err instanceof Error ? err : new Error(String(err));
            deps.log.warn(`[Config] download network error: name=${e.name}, msg=${e.message}, elapsedMs=${now() - downloadStartedAt}`);
            deps.recordFlowFailure(event({
                phase: 'download', status: 'fail',
                errorCode: errorCodeOf(classifyFetchError(e)),
                durationMs: now() - downloadStartedAt,
            }));
            deps.haptics.notifyError();
            setPhase({ phase: 'error', error: { kind: 'download-network', message: e.message } });
            return;
        }
        if (cancelled) return;
        deps.log.debug(`[Config] download response: status=${response.statusCode}, elapsedMs=${now() - downloadStartedAt}`);

        if (response.statusCode < 200 || response.statusCode >= 300) {
            deps.log.warn(`[Config] download HTTP failure: status=${response.statusCode}`);
            deps.recordFlowFailure(event({
                phase: 'download', status: 'fail',
                errorCode: errorCodeOf('http', response.statusCode),
                durationMs: now() - downloadStartedAt,
            }));
            deps.haptics.notifyError();
            setPhase({ phase: 'error', error: { kind: 'download-http', statusCode: response.statusCode } });
            return;
        }

        // ── Store ────────────────────────────────────────────
        // 验收门：body 不是配置的 HTTP 200（例如代理透传了无法解码的字节）
        // 必须在此失败 —— 绝不持久化，也绝不进入 start()。
        const content = response.body;
        const verdict = validateConfigContent(content);
        if (!verdict.ok) {
            deps.log.warn(`[Config] download rejected: invalid config content (reason=${verdict.reason}, bytes=${content.length})`);
            deps.recordFlowFailure(event({
                phase: 'download', status: 'fail',
                errorCode: ERROR_CODE_INVALID_CONTENT,
                durationMs: now() - downloadStartedAt,
                detail: `reason=${verdict.reason} bytes=${content.length}`,
            }));
            deps.haptics.notifyError();
            setPhase({ phase: 'error', error: { kind: 'invalid-content', reason: verdict.reason } });
            return;
        }
        const getHeader = (name: string): string | null => {
            const headers = response.headers ?? {};
            return headers[name] ?? headers[name.toLowerCase()] ?? null;
        };

        const { upload, download, total, expire } = parseProfileUserinfo(
            getHeader('subscription-userinfo')
        );

        const name =
            getRemoteNameByContentDisposition(getHeader('content-disposition') ?? '')
            ?? deps.profiles.findByUrl(url)?.name
            ?? deriveProfileNameFromUrl(url);

        deps.profiles.upsertByUrl({
            name,
            url,
            usedTraffic: upload + download,
            totalTraffic: total,
            expireTime: expire,
            configContent: content,
        });
        deps.onActiveProfileChanged?.();
        const extraInfo: ImportExtraInfo = { upload, download, total, expire };
        deps.haptics.notifySuccess();
        deps.log.info(`[Config] download success: bytes=${content.length}, name=${JSON.stringify(name)}, hasTraffic=${total > 0}, hasExpire=${expire > 0}, elapsedMs=${now() - downloadStartedAt}`);
        deps.logFlowEvent(event({
            phase: 'download', status: 'ok',
            durationMs: now() - downloadStartedAt,
        }));
        deps.logFlowEvent(event({
            phase: 'store', status: 'ok',
            profileIdHash: djb2Hash(url),
        }));

        if (!willApply) {
            setPhase({ phase: 'success', extraInfo });
            return;
        }

        // ── Apply ────────────────────────────────────────────
        setPhase({ phase: 'applying' });
        const applyStartedAt = now();
        deps.log.info(`[Config] apply: calling context start({ timeoutMs: ${startTimeoutMs} })`);
        deps.logFlowEvent(event({ phase: 'start', status: 'start' }));
        const result = await deps.start({ timeoutMs: startTimeoutMs, signal: startAbort.signal });
        if (cancelled) {
            deps.log.debug('[Config] apply: cancelled after start, dropping');
            return;
        }
        if (!result.ok) {
            if (result.failure.kind === 'aborted') {
                deps.log.debug('[Config] apply: start aborted mid-phase (effect cleanup), dropping');
                return;
            }
            // 把 native/config 错误文本留在 error 级日志环 —— 日志查看器是
            // 唯一的事后诊断入口。
            deps.log.error(`[Config] apply: start failed → kind=${result.failure.kind}${'message' in result.failure ? `, message=${result.failure.message}` : ''}`);
            deps.recordFlowFailure(event({
                phase: 'start', status: 'fail',
                errorCode: startFailureErrorCode(result.failure),
                durationMs: now() - applyStartedAt,
            }));
            deps.haptics.notifyError();
            setPhase({ phase: 'error', error: { kind: 'start-failed', failure: result.failure } });
            return;
        }
        deps.log.info(`[Config] apply: start resolved ok, startElapsedMs=${now() - applyStartedAt}`);
        deps.logFlowEvent(event({
            phase: 'start', status: 'ok',
            durationMs: now() - applyStartedAt,
        }));
        deps.logFlowEvent(event({ phase: 'apply', status: 'ok' }));
        setPhase({ phase: 'applied' }); // 适配器导航回 home
    }

    return {
        getSnapshot: () => phase,
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        run(): void {
            if (started) return;
            started = true;
            void runPipeline();
        },
        cancel(): void {
            cancelled = true;
            startAbort.abort();
        },
        flowId,
    };
}
