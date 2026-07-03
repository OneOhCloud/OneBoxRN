/**
 * Config import pipeline — pure state machine with injected dependencies.
 *
 * Absorbs the effect chain previously spread across ConfigScreen
 * (src/app/config/index.tsx): capture → verify → stop → download → store →
 * start → apply. One machine instance runs one import; the flowId is a
 * closure field stamped on every emitted FlowEvent, so nothing threads it.
 * The UI adapter (use-import-flow.ts) subscribes via the external-store
 * pattern and maps typed errors onto i18n strings — no presentation here.
 *
 * run() is latched: it executes at most one pipeline, and stays latched
 * after cancel() — identical to the previous unmount semantics (this app
 * does not run React StrictMode, so effects fire once).
 *
 * Flow-event parity note: the former screen derived the start-phase fail
 * errorCode by text-classifying the already-localized failure message —
 * locale-dependent junk for 'permission-denied'/'timeout'. This machine maps
 * those two kinds directly (PERMISSION_DENIED / TIMEOUT) and keeps message
 * classification for config-error / native-error, whose messages are real
 * native strings. Telemetry-only, declared change.
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
    /** Raw search params, exactly as the screen receives them. */
    data: string | undefined;
    apply: string | undefined;
}

export interface ImportFlowDeps {
    /** Hostname allowlist check (@/utils/domain-verification — impure, injected). */
    verifyHostname(hostname: string): Promise<boolean>;
    /** Context actions — the machine orchestrates intents, never the bridge. */
    stop(options?: StopOptions): Promise<StopResult>;
    start(options?: StartOptions): Promise<StartResult>;
    /** Native config download for the import flow (ExpoOneBox.fetchProfileConfig). */
    fetchConfig(url: string, userAgent: string): Promise<ConfigFetchResult>;
    userAgent: string;
    profiles: Pick<ProfileStoreApi, 'findByUrl' | 'upsertByUrl'>;
    logFlowEvent(event: FlowEvent): void;
    recordFlowFailure(event: FlowEvent): void;
    haptics: { notifySuccess(): void; notifyError(): void };
    log: VpnLogger;
    /** Duration clock; default Date.now. */
    now?(): number;
    /** Base64 decoder; default global atob (present on Hermes and node). */
    decodeBase64?(s: string): string;
}

export interface ImportFlowOptions {
    /** Stop-wait cap before the apply-path download. Default 10_000. */
    stopTimeoutMs?: number;
    /** Wall-clock cap on the auto-apply start. Default 20_000. */
    startTimeoutMs?: number;
}

export interface ImportFlowMachine {
    getSnapshot(): ImportPhase;
    subscribe(listener: () => void): () => void;
    /** Latched — at most one pipeline per machine. */
    run(): void;
    /** Drop pending results and abort the start at its phase boundaries. */
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
    // Decode the deep-link payload; only https URLs are usable.
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

    // Decoded at construction so the INITIAL snapshot already reflects the
    // pipeline's first phase: an apply=1 deep link must render LoadingView on
    // its very first committed frame (parity with the old screen, whose lazy
    // `shouldApply=null` init made `busy` true before any effect ran) — never
    // a one-frame DefaultView flash.
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
        if (!url) return; // stays idle → DefaultView

        // ── Verify ───────────────────────────────────────────
        // apply=1 only takes effect for hostnames on the verification
        // allowlist; unverified hosts downgrade to manual import.
        let willApply = false;
        if (requestedApply) {
            // Already the initial phase (see the construction-time decode).
            const startedAt = now();
            deps.log.info('[Config] verify: starting hostname allowlist check');
            // Unparseable URL → '' → treated as unverified below.
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
        // Auto-apply must stop a running tunnel before downloading; every
        // StopResult outcome proceeds to the download.
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
        // Acceptance gate: an HTTP 200 whose body is not a config (e.g. a
        // proxy handing through undecodable bytes) must fail here — never
        // persist and never reach start().
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
            // Keep the native/config error text in the error-level log ring —
            // the Logs viewer is the only post-hoc diagnostic surface.
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
        setPhase({ phase: 'applied' }); // adapter navigates home
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
