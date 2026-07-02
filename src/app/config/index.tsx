/**
 * Config Import Screen — downloads and displays profile configuration.
 * Reached via deep link or QR scan with base64-encoded URL in search params.
 */
import { mediumImpact, notifyError, notifySuccess } from '@/components/ui/haptics';
import i18n from '@/constants/language';
import { Fonts } from '@/constants/theme';
import { useVpn } from '@/contexts/vpn-context';
import type { StartFailure } from '@/contexts/vpn/types';
import { ProfileStore } from '@/database/kv';
import { useTheme } from '@/hooks/use-theme';
import ExpoOneBox from '@/modules/expo-onebox';
import { fmtBytes, getRemoteNameByContentDisposition, getSingBoxUserAgent, urlFilename, urlHostname } from '@/utils';
import { jsLog } from '@/utils/log-sink';
import { parseProfileUserinfo } from '@/utils/profile-info';
import { verifyHostname } from '@/utils/domain-verification';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// ─── Download Hook ──────────────────────────────────────────
function useDownloadConfig(url: string | undefined) {
    const [data, setData] = useState<string | null>(null);
    const [error, setError] = useState<Error | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [extraInfo, setExtraInfo] = useState<{
        upload: number;
        download: number;
        total: number;
        expire: number;
    } | null>(null);

    // Reset-on-url-change is adjusted during render (guarded setState, per
    // React's "adjusting state when props change") so the fetch effect never
    // sets state synchronously.
    const [prevUrl, setPrevUrl] = useState<string | undefined>(undefined);
    if (prevUrl !== url) {
        setPrevUrl(url);
        setIsLoading(!!url);
        setError(null);
        setData(null);
    }

    useEffect(() => {
        if (!url) {
            jsLog.debug('[Config] useDownloadConfig: url undefined, skipping fetch');
            return;
        }
        jsLog.info(`[Config] download start: host=${urlHostname(url, '(unparseable)')}`);

        const controller = new AbortController();
        const { signal } = controller;
        const startedAt = Date.now();

        ExpoOneBox.fetchSubscription(url, getSingBoxUserAgent())
            .then((response) => {
                if (signal.aborted) {
                    jsLog.debug('[Config] download .then bailed, signal aborted');
                    return;
                }
                jsLog.debug(`[Config] download response: status=${response.statusCode}, elapsedMs=${Date.now() - startedAt}`);

                if (response.statusCode < 200 || response.statusCode >= 300) {
                    const err = new Error(i18n.t('config_error_status', { code: response.statusCode }));
                    jsLog.warn(`[Config] download HTTP failure: status=${response.statusCode}`);
                    setError(err);
                    notifyError();
                    return;
                }

                const content = response.body;
                setData(content);

                const getHeader = (name: string): string | null => {
                    const headers = response.headers ?? {};
                    return headers[name] ?? headers[name.toLowerCase()] ?? null;
                };

                const { upload, download, total, expire } = parseProfileUserinfo(
                    getHeader('subscription-userinfo')
                );

                const name =
                    getRemoteNameByContentDisposition(getHeader('content-disposition') ?? '')
                    ?? ProfileStore.findByUrl(url)?.name
                    ?? urlFilename(url)
                    ?? urlHostname(url, 'Profile');

                ProfileStore.upsertByUrl({
                    name,
                    url,
                    usedTraffic: upload + download,
                    totalTraffic: total,
                    expireTime: expire,
                    configContent: content,
                });
                setExtraInfo({ upload, download, total, expire });
                notifySuccess();
                jsLog.info(`[Config] download success: bytes=${content.length}, name=${JSON.stringify(name)}, hasTraffic=${total > 0}, hasExpire=${expire > 0}, elapsedMs=${Date.now() - startedAt}`);
            })
            .catch((fetchError: Error) => {
                if (signal.aborted) {
                    jsLog.debug(`[Config] download .catch suppressed, signal aborted (err=${fetchError.name})`);
                    return;
                }
                jsLog.warn(`[Config] download network error: name=${fetchError.name}, msg=${fetchError.message}, elapsedMs=${Date.now() - startedAt}`);
                setError(fetchError);
                notifyError();
            })
            .finally(() => {
                if (signal.aborted) {
                    jsLog.debug('[Config] download .finally skipped isLoading=false (aborted)');
                    return;
                }
                setIsLoading(false);
                jsLog.debug('[Config] download .finally → isLoading=false');
            });

        return () => {
            jsLog.debug('[Config] useDownloadConfig cleanup → controller.abort()');
            controller.abort();
        };
    }, [url]);

    return { data, error, isLoading, extraInfo };
}

/**
 * Maps a typed context-start failure onto this screen's user-visible
 * message vocabulary (all wrapped in `config_apply_failed` by the apply
 * effect's catch, matching the previous throw-based strings exactly).
 * 'aborted' is handled before mapping — effect cleanup mid-phase.
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

// ─── Shared: Icon Orb ───────────────────────────────────────
function IconOrb({
    name,
    color,
    tint,
}: {
    name: keyof typeof Ionicons.glyphMap;
    color: string;
    tint: string;
}) {
    return (
        <View
            style={{
                width: 76,
                height: 76,
                borderRadius: 38,
                backgroundColor: tint,
                alignItems: 'center',
                justifyContent: 'center',
            }}
        >
            <Ionicons name={name} size={36} color={color} />
        </View>
    );
}

// ─── Loading State ──────────────────────────────────────────
function LoadingView() {
    const theme = useTheme();
    return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}>
            <IconOrb name="cloud-download-outline" color="#007AFF" tint="#007AFF18" />
            <Text style={{ fontSize: 17, fontWeight: '600', fontFamily: Fonts?.rounded, color: theme.text, marginTop: 20, letterSpacing: -0.4, lineHeight: 24 }}>
                {i18n.t('config_downloading')}
            </Text>
            <Text style={{ fontSize: 15, color: theme.textSecondary, marginTop: 6 }}>
                {i18n.t('config_please_wait')}
            </Text>
            <ActivityIndicator size="large" color="#007AFF" style={{ marginTop: 32 }} />
        </View>
    );
}

// ─── Error State ────────────────────────────────────────────
function ErrorView({ message }: { message: string }) {
    const theme = useTheme();
    return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, backgroundColor: theme.background }}>
            <IconOrb name="alert-circle" color="#FF3B30" tint="#FF3B3015" />
            <Text style={{ fontSize: 17, fontWeight: '600', fontFamily: Fonts?.rounded, color: theme.text, marginTop: 20, letterSpacing: -0.4, lineHeight: 24 }}>
                {i18n.t('config_download_failed_title')}
            </Text>
            <Text style={{ fontSize: 15, color: theme.textSecondary, marginTop: 6, textAlign: 'center' }}>
                {i18n.t('config_download_failed_hint')}
            </Text>
            <View
                style={{
                    width: '100%',
                    maxWidth: 360,
                    marginTop: 20,
                    borderRadius: 14,
                    backgroundColor: theme.cardBackground,
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                }}
            >
                <ScrollView style={{ maxHeight: 110 }} showsVerticalScrollIndicator={false}>
                    <Text style={{ fontSize: 13, color: '#FF3B30', lineHeight: 19, fontFamily: Fonts?.mono }}>
                        {message}
                    </Text>
                </ScrollView>
            </View>
            <Pressable
                onPress={() => { mediumImpact(); router.back(); }}
                style={({ pressed }) => ({
                    marginTop: 24,
                    minWidth: 120,
                    alignItems: 'center',
                    paddingHorizontal: 32,
                    paddingVertical: 13,
                    borderRadius: 100,
                    backgroundColor: theme.backgroundElement,
                    opacity: pressed ? 0.55 : 1,
                })}
                hitSlop={8}
            >
                <Text style={{ fontSize: 15, fontWeight: '500', color: theme.text }}>{i18n.t('back')}</Text>
            </Pressable>
        </View>
    );
}

// ─── Success State ──────────────────────────────────────────
function InfoRow({
    label,
    value,
    theme,
    isLast,
}: {
    label: string;
    value: string;
    theme: ReturnType<typeof useTheme>;
    isLast?: boolean;
}) {
    return (
        <View
            style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingVertical: 13,
                borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
                borderBottomColor: theme.border,
            }}
        >
            <Text style={{ fontSize: 15, color: theme.textSecondary }}>{label}</Text>
            <Text style={{ fontSize: 15, fontWeight: '500', color: theme.text }}>{value}</Text>
        </View>
    );
}

function SuccessView({
    extraInfo,
}: {
    extraInfo: { upload: number; download: number; total: number; expire: number } | null;
}) {
    const theme = useTheme();
    const used = extraInfo ? extraInfo.upload + extraInfo.download : 0;
    const total = extraInfo ? extraInfo.total : 0;
    const expireDate = extraInfo && extraInfo.expire > 0 ? new Date(extraInfo.expire * 1000) : null;
    const left = total > used ? total - used : 0;
    const usedPercent = total > 0 ? Math.min((used / total) * 100, 100) : 0;
    const isNearLimit = usedPercent > 85;

    return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, backgroundColor: theme.background }}>
            <IconOrb name="checkmark-circle" color="#34C759" tint="#34C75915" />
            <Text style={{ fontSize: 17, fontWeight: '600', fontFamily: Fonts?.rounded, color: theme.text, marginTop: 20, letterSpacing: -0.4, lineHeight: 24 }}>
                {i18n.t('config_import_success_title')}
            </Text>
            <Text style={{ fontSize: 15, color: theme.textSecondary, marginTop: 6 }}>
                {i18n.t('config_import_success_hint')}
            </Text>

            {/* Info card */}
            <View
                style={{
                    width: '100%',
                    maxWidth: 360,
                    marginTop: 28,
                    borderRadius: 16,
                    backgroundColor: theme.cardBackground,
                    paddingHorizontal: 16,
                    overflow: 'hidden',
                }}
            >
                {/* Traffic section */}
                {total > 0 && (
                    <View style={{ paddingTop: 14, paddingBottom: 4 }}>
                        {/* Label row */}
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                            <Text style={{ fontSize: 13, fontWeight: '500', color: theme.textSecondary }}>
                                {i18n.t('config_traffic_label')}
                            </Text>
                            <Text style={{ fontSize: 13, fontWeight: '600', color: isNearLimit ? '#FF3B30' : theme.text }}>
                                {i18n.t('config_traffic_remaining', { amount: fmtBytes(left) })}
                            </Text>
                        </View>
                        {/* Progress track */}
                        <View style={{ width: '100%', height: 6, borderRadius: 3, backgroundColor: theme.backgroundElement }}>
                            <View
                                style={{
                                    height: 6,
                                    borderRadius: 3,
                                    width: `${usedPercent}%`,
                                    backgroundColor: isNearLimit ? '#FF3B30' : '#007AFF',
                                }}
                            />
                        </View>
                        {/* Sub labels */}
                        <View
                            style={{
                                flexDirection: 'row',
                                justifyContent: 'space-between',
                                marginTop: 8,
                                paddingBottom: 13,
                                borderBottomWidth: StyleSheet.hairlineWidth,
                                borderBottomColor: theme.border,
                            }}
                        >
                            <Text style={{ fontSize: 12, color: theme.textSecondary }}>
                                {i18n.t('config_traffic_used_label', { amount: fmtBytes(used), percent: usedPercent.toFixed(1) })}
                            </Text>
                            <Text style={{ fontSize: 12, color: theme.textSecondary }}>
                                {i18n.t('config_traffic_total_label', { amount: fmtBytes(total) })}
                            </Text>
                        </View>
                    </View>
                )}

                {/* Expire row */}
                <InfoRow
                    label={i18n.t('expire_time')}
                    value={expireDate ? expireDate.toLocaleDateString() : i18n.t('config_no_expire')}
                    theme={theme}
                    isLast
                />
            </View>

            {/* CTA */}
            <Pressable
                onPress={() => { mediumImpact(); router.dismissTo('/'); }}
                style={({ pressed }) => ({
                    marginTop: 32,
                    width: '100%',
                    maxWidth: 360,
                    alignItems: 'center',
                    paddingVertical: 16,
                    borderRadius: 14,
                    backgroundColor: '#007AFF',
                    opacity: pressed ? 0.72 : 1,
                })}
            >
                <Text style={{ color: '#ffffff', fontSize: 17, fontWeight: '600', letterSpacing: -0.3, fontFamily: Fonts?.rounded, lineHeight: 24 }}>
                    {i18n.t('config_get_started')}
                </Text>
            </Pressable>
        </View>
    );
}

// ─── Default / No URL State ─────────────────────────────────
function DefaultView() {
    const theme = useTheme();
    return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}>
            <IconOrb name="link-outline" color={theme.textSecondary} tint={theme.backgroundElement} />
            <Text style={{ fontSize: 15, color: theme.textSecondary, marginTop: 16, textAlign: 'center' }}>
                {i18n.t('config_deep_link_hint')}
            </Text>
        </View>
    );
}

// ─────────────────────────────────────────────────────────────
// Config Import Screen
// ─────────────────────────────────────────────────────────────

export default function ConfigScreen() {
    const theme = useTheme();
    const { data: deepLinkData, apply } = useLocalSearchParams<{ data: string; apply?: string }>();
    const requestedApply = apply === '1';

    let decodedUrl: string | undefined;
    let decodeError: string | null = null;
    if (deepLinkData) {
        try {
            decodedUrl = atob(deepLinkData);
            if (!decodedUrl.startsWith('https://')) {
                decodeError = `decoded but not https (prefix=${decodedUrl.slice(0, 16)})`;
                decodedUrl = undefined;
            }
        } catch (e) {
            decodeError = `atob threw: ${(e as Error).message}`;
            decodedUrl = undefined;
        }
    }

    const { start, stop } = useVpn();

    // Mount log — emitted once per mount (ref-guarded effect; refs are legal
    // there). Captures the exact param shape the screen was handed, which is
    // the starting point for every stuck-import trace.
    const mountLoggedRef = useRef(false);
    useEffect(() => {
        if (mountLoggedRef.current) return;
        mountLoggedRef.current = true;
        jsLog.info(
            `[Config] mount: hasData=${!!deepLinkData}, dataBytes=${deepLinkData?.length ?? 0}, apply=${apply ?? '(none)'}, requestedApply=${requestedApply}, decodedHost=${decodedUrl ? urlHostname(decodedUrl, '(none)') : '(none)'}`
        );
        if (decodeError) {
            jsLog.warn(`[Config] mount: deep link payload rejected → ${decodeError}`);
        }
    });

    // Errors that arise outside the download hook (verify, apply) are kept
    // here so the screen can render a visible `ErrorView` instead of
    // pinning `LoadingView` forever. A single source of truth (`applyError`)
    // combined with the download-hook's `error` drives the `ErrorView`.
    const [applyError, setApplyError] = useState<Error | null>(null);

    // apply=1 only takes effect for hostnames on the verification allowlist;
    // unverified hosts fall back to apply=0 behaviour (download + show
    // success card, no auto-start). The `null` placeholder blocks the
    // download/stop side effects until verification resolves.
    const [shouldApply, setShouldApply] = useState<boolean | null>(() =>
        !decodedUrl || !requestedApply ? false : null,
    );
    useEffect(() => {
        if (!decodedUrl) {
            jsLog.info('[Config] verify: no usable decodedUrl → shouldApply=false (decided at init)');
            return;
        }
        if (!requestedApply) {
            jsLog.info('[Config] verify: apply!=1 in params → shouldApply=false (decided at init)');
            return;
        }
        let cancelled = false;
        const startedAt = Date.now();
        jsLog.info('[Config] verify: starting hostname allowlist check');
        (async () => {
            let hostname = '';
            try {
                hostname = new URL(decodedUrl).hostname;
            } catch (e) {
                jsLog.warn(`[Config] verify: URL parse failed for decodedUrl → ${(e as Error).message}`);
                // unparseable URL → treat as unverified
            }
            jsLog.debug(`[Config] verify: hostname=${hostname || '(empty)'}`);
            const verified = hostname ? await verifyHostname(hostname) : false;
            if (cancelled) {
                jsLog.debug('[Config] verify: resolved after cancel, dropping result');
                return;
            }
            jsLog.info(`[Config] verify: done verified=${verified}, elapsedMs=${Date.now() - startedAt} → shouldApply=${verified}`);
            if (!verified) {
                jsLog.warn('[Config] apply=1 domain not on allowlist, downgrading to manual import');
            }
            setShouldApply(verified);
        })().catch((err) => {
            // Any rejection here (e.g. `crypto.subtle` missing on RN, remote
            // allowlist fetch failing fatally) becomes a visible error —
            // previously these sank into an unhandled promise and the screen
            // pinned at LoadingView forever.
            if (cancelled) return;
            const e = err instanceof Error ? err : new Error(String(err));
            jsLog.error(`[Config] verify failed → ${e.message}`);
            setApplyError(new Error(i18n.t('config_verify_failed', { message: e.message })));
        });
        return () => {
            jsLog.debug('[Config] verify effect cleanup');
            cancelled = true;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // When apply=1 and VPN is running, we must stop the VPN first before downloading.
    // `downloadUrl` is only set (triggering the fetch) once any required stop is
    // complete. The context's stop() encapsulates the former listener + timers:
    // it resolves on STOPPED, on the 10 s timeout, on stop-reject (+300 ms grace)
    // or immediately as 'already-stopped' — every outcome proceeds to download,
    // matching the previous proceed(source) semantics.
    const [downloadUrl, setDownloadUrl] = useState<string | undefined>(undefined);
    const stopInitiatedRef = useRef(false);
    // Derived: true exactly while the stop-wait gates the download.
    const isStopping = shouldApply === true && downloadUrl === undefined;

    useEffect(() => {
        if (!decodedUrl) {
            jsLog.debug('[Config] pre-download effect: no decodedUrl, skip');
            return;
        }
        if (shouldApply === null) {
            jsLog.debug('[Config] pre-download effect: shouldApply=null, waiting for verify');
            return;
        }

        let cancelled = false;

        if (!shouldApply) {
            jsLog.info('[Config] pre-download: shouldApply=false → setDownloadUrl directly (no stop-wait)');
            // Microtask keeps the write out of the synchronous effect body.
            void Promise.resolve().then(() => {
                if (!cancelled) setDownloadUrl(decodedUrl);
            });
            return () => {
                cancelled = true;
            };
        }

        // shouldApply: stop VPN first (awaitable), then trigger download.
        if (stopInitiatedRef.current) {
            jsLog.debug('[Config] pre-download effect: stopInitiatedRef latched, skipping re-entry');
            return;
        }
        stopInitiatedRef.current = true;

        const stopStartedAt = Date.now();
        jsLog.info('[Config] pre-download: shouldApply=true → context stop({ timeoutMs: 10000 })');
        void stop({ timeoutMs: 10_000 }).then((result) => {
            if (cancelled) {
                jsLog.debug('[Config] stop resolved after cleanup, dropping');
                return;
            }
            jsLog.info(`[Config] stop→download handoff: outcome=${result.outcome}, elapsedMs=${Date.now() - stopStartedAt}`);
            setDownloadUrl(decodedUrl);
        });

        return () => {
            jsLog.debug('[Config] pre-download effect cleanup (stop-wait branch)');
            cancelled = true;
        };
    // decodedUrl is derived from route params and never changes; shouldApply
    // transitions exactly once from null → bool.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shouldApply]);

    const { data, error, isLoading, extraInfo } = useDownloadConfig(downloadUrl);

    const [isApplying, setIsApplying] = useState(false);
    const appliedRef = useRef(false);

    useEffect(() => {
        if (!data || !shouldApply || appliedRef.current) {
            if (!data) jsLog.debug('[Config] apply effect: data not ready, skip');
            else if (!shouldApply) jsLog.debug('[Config] apply effect: shouldApply not true, skip');
            else if (appliedRef.current) jsLog.debug('[Config] apply effect: appliedRef latched, skip');
            return;
        }
        appliedRef.current = true;

        let cancelled = false;
        // Aborting mid-phase (permission dialog up, config processing) on
        // effect cleanup preserves the previous property that unmounting
        // does not proceed to a tunnel start.
        const controller = new AbortController();

        async function startAfterImport() {
            const startedAt = Date.now();
            jsLog.info('[Config] apply: startAfterImport enter, setIsApplying(true)');
            setIsApplying(true);
            try {
                // Permission gate, config processing and the 20 s wall-clock
                // race (native start can hang if the preceding stop left the
                // tunnel in an intermediate state) all live inside the
                // context action now.
                jsLog.info('[Config] apply: calling context start({ timeoutMs: 20000 })');
                const startInvokedAt = Date.now();
                const result = await start({ timeoutMs: 20_000, signal: controller.signal });
                if (cancelled) {
                    jsLog.debug('[Config] apply: cancelled after start, skipping dismissTo');
                    return;
                }
                if (!result.ok) {
                    if (result.failure.kind === 'aborted') {
                        jsLog.debug('[Config] apply: start aborted mid-phase (effect cleanup), dropping');
                        return;
                    }
                    throw new Error(mapStartFailureMessage(result.failure));
                }
                jsLog.info(`[Config] apply: start resolved ok, startElapsedMs=${Date.now() - startInvokedAt}, totalElapsedMs=${Date.now() - startedAt}`);

                jsLog.info('[Config] apply: success → router.dismissTo("/")');
                router.dismissTo('/');
            } catch (e: unknown) {
                if (cancelled) {
                    jsLog.debug(`[Config] apply: error after cancel, swallowed: ${(e as Error)?.message ?? String(e)}`);
                    return;
                }
                const raw = e instanceof Error ? e.message : String(e);
                jsLog.error(`[Config] apply: threw → ${raw}`);
                // Surface every apply-path failure via the shared ErrorView.
                // Going through `applyError` + ErrorView (instead of an
                // Alert) guarantees the screen exits LoadingView — the
                // `busy` expression below short-circuits once either error
                // source is set.
                notifyError();
                setApplyError(new Error(i18n.t('config_apply_failed', { message: raw })));
            } finally {
                if (!cancelled) {
                    setIsApplying(false);
                    jsLog.debug('[Config] apply: finally → setIsApplying(false)');
                }
            }
        }

        startAfterImport();

        return () => {
            jsLog.debug('[Config] apply effect cleanup (cancelled=true)');
            cancelled = true;
            controller.abort();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data, shouldApply]);

    // When apply=1, keep showing loading until navigation fires (covers the gap
    // between isLoading→false and isApplying→true across the effect render cycle).
    // Also cover the brief domain-verification gap (shouldApply === null).
    const verifying = requestedApply && shouldApply === null;
    // A fatal error from any source short-circuits the busy gate so the
    // screen can route to `ErrorView` — without this, the
    // `shouldApply === true && !!data` disjunct pins LoadingView even
    // after `startAfterImport` rejects.
    const displayError = error ?? applyError;
    const busy =
        !displayError && (
            verifying ||
            isStopping ||
            isLoading ||
            isApplying ||
            (shouldApply === true && !!data)
        );

    // Trace state of every `busy` disjunct whenever one of them changes.
    // The stuck-at-LoadingView diagnosis reduces to "which disjunct refuses
    // to go false", so logging them individually on transition gives the
    // answer without manual probing.
    const busySignatureRef = useRef<string | null>(null);
    useEffect(() => {
        const sig = `verifying=${verifying} isStopping=${isStopping} isLoading=${isLoading} isApplying=${isApplying} shouldApply=${shouldApply} hasData=${!!data} dlError=${!!error} applyError=${!!applyError}`;
        if (busySignatureRef.current === sig) return;
        busySignatureRef.current = sig;
        jsLog.debug(`[Config] busy recompute: busy=${busy} | ${sig}`);
    }, [verifying, isStopping, isLoading, isApplying, shouldApply, data, error, applyError, busy]);

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
            {/* Navigation bar — standard iOS inline title style */}
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, minHeight: 44 }}>
                <Pressable
                    onPress={() => router.back()}
                    style={({ pressed }) => ({
                        width: 44,
                        height: 44,
                        borderRadius: 22,
                        alignItems: 'center',
                        justifyContent: 'center',
                        opacity: pressed ? 0.55 : 1,
                    })}
                    hitSlop={8}
                >
                    <Ionicons name="chevron-back" size={22} color="#007AFF" />
                </Pressable>
                <Text
                    numberOfLines={1}
                    style={{
                        flex: 1,
                        textAlign: 'center',
                        fontSize: 17,
                        fontWeight: '600',
                        color: theme.text,
                        marginHorizontal: 8,
                        fontFamily: Fonts?.sans,
                    }}
                >
                    {i18n.t('import_subscription')}
                </Text>
                {/* Spacer to balance back button */}
                <View style={{ width: 44 }} />
            </View>

            {/* Content states */}
            {busy && <LoadingView />}
            {!busy && displayError && <ErrorView message={displayError.message} />}
            {!busy && !displayError && data && shouldApply !== true && <SuccessView extraInfo={extraInfo} />}
            {!busy && !displayError && !data && <DefaultView />}
        </SafeAreaView>
    );
}
