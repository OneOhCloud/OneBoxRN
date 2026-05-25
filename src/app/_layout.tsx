/**
 * Root layout — Stack navigator with theme-aware navigation chrome.
 * Wraps the entire app in a ThemeProvider for react-navigation dark mode support.
 */

import { VpnProvider } from '@/contexts/vpn-context';
import { DatabaseProvider } from '@/database/sqlite3';
import { AppLaunchFlags, BugsnagCrashTestFlags, migrateV1ProfileToMulti } from '@/database/kv';
import { prefetchConfigTemplates } from '@/database/helper';
import * as Task from '@/tasks/config-refresh';
import { fetchWithTimeout } from '@/utils';
import { updateVerificationData } from '@/utils/domain-verification';
import { jsLog } from '@/utils/log-sink';
import Bugsnag from '@bugsnag/expo';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router/react-navigation';
import { Asset } from 'expo-asset';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { AppState, Platform, Text, useColorScheme, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import '../global.css';
import ExpoOneBox from '../modules/expo-onebox';

const bugsnagApiKey = Constants.expoConfig?.extra?.bugsnag?.apiKey;
const bugsnagEnabled = typeof bugsnagApiKey === 'string' && bugsnagApiKey.length > 0;

if (bugsnagEnabled) {
    Bugsnag.start({ apiKey: bugsnagApiKey });
}

const ErrorBoundary = bugsnagEnabled
    ? Bugsnag.getPlugin('react')!.createErrorBoundary(React)
    : null;

// ---------------------------------------------------------------------------
// First-launch initialization helper
// ---------------------------------------------------------------------------

async function copyCacheDb() {
    try {
        const [asset] = await Asset.loadAsync(require('../../assets/data/tun.db'));
        if (!asset.localUri) return;
        const copied = await ExpoOneBox.copy2CacheDbPath(asset.localUri);
        if (copied) {
            jsLog.info('[copyCacheDb] tun.db copied successfully');
        } else {
            jsLog.info('[copyCacheDb] tun.db already exists, skipped');
        }
    } catch (e) {
        jsLog.warn('[copyCacheDb] error:', e);
    }
}

async function runFirstLaunchSetup() {
    try {
        if (Platform.OS === 'android') {
            // Request notification permission via expo-notifications (Android 13+ POST_NOTIFICATIONS)
            await Notifications.requestPermissionsAsync();
            // Request battery optimization exemption so the VPN service can run unrestricted in the background
            try {
                const exempt = ExpoOneBox.checkBatteryOptimizationExemption();
                if (!exempt) {
                    await ExpoOneBox.requestBatteryOptimizationExemption();
                }
            } catch (e) {
                jsLog.warn('[FirstLaunch] battery optimization exemption request failed:', e);
            }
        } else if (Platform.OS === 'ios') {
            // 苹果的网络权限需要在 app 运行时通过实际请求触发，无法通过静态清单声明或安装时授权，因此我们在首次启动时发出一个请求来触发权限对话框。
            fetchWithTimeout('https://www.apple.com/library/test/success.html').then(() => {
                jsLog.info('[RootLayout] network permission check complete');
            }).catch((e) => {
                jsLog.warn('[RootLayout] network permission check error:', e);
            });
        }
    } catch (e) {
        // Non-fatal — log and continue
        jsLog.warn('[FirstLaunch] setup error:', e);
    } finally {
        AppLaunchFlags.markFirstLaunchDone();
    }
}

function runBugsnagCrashTestIfArmed() {
    const kind = BugsnagCrashTestFlags.consume();
    if (!kind) return;

    if (kind === 'js') {
        jsLog.warn('[BugsnagTest] Triggering intentional JS crash on startup');
        if (bugsnagEnabled) {
            Bugsnag.notify(new Error('Bugsnag JS crash test notify'));
        }
        setTimeout(() => {
            throw new Error('Bugsnag JS crash test');
        }, 0);
        return;
    }

    if (Platform.OS === 'android') {
        jsLog.warn('[BugsnagTest] Triggering intentional Android native crash on startup');
        ExpoOneBox.crashForBugsnagTest();
    } else {
        jsLog.warn('[BugsnagTest] Android native crash test ignored on non-Android platform');
    }
}

function BugsnagErrorView() {
    return (
        <View
            style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                padding: 24,
                backgroundColor: '#F2F2F7',
            }}
        >
            <Text
                style={{
                    fontSize: 20,
                    fontWeight: '700',
                    color: '#1C1C1E',
                    textAlign: 'center',
                    marginBottom: 8,
                }}
            >
                Something went wrong
            </Text>
            <Text
                style={{
                    fontSize: 15,
                    lineHeight: 21,
                    color: '#636366',
                    textAlign: 'center',
                }}
            >
                The error has been reported. Restart the app to continue.
            </Text>
        </View>
    );
}

// ---------------------------------------------------------------------------

export default function RootLayout() {
    const colorScheme = useColorScheme();

    useEffect(() => {
        // 单订阅 → 多订阅格式迁移（一次性，幂等）
        migrateV1ProfileToMulti();
        runBugsnagCrashTestIfArmed();

        // Initialize domain verification data (fetch and cache) before registering background task
        Task.initializeConfigRefresh()
            .then(() => {
                jsLog.info('[RootLayout] config refresh initialization complete');
                // Now register background task with populated verification data
                Task.registerConfigRefreshTask();
            })
            .catch((e) => {
                jsLog.warn('[RootLayout] config refresh initialization error:', e);
                // Still register task even if verification data fetch failed, it will use defaults
                Task.registerConfigRefreshTask();
            });

        // Sync any result that the native background task stored while the app was suspended
        Task.syncNativeResultToJS();

        const appStateSub = AppState.addEventListener('change', (nextState) => {
            if (nextState === 'active') {
                Task.syncNativeResultToJS();

                // Re-prefetch remote assets when returning to foreground,
                // only if the tunnel is not routing traffic (otherwise the
                // request stalls on the TUN interface). Both calls are
                // TTL-gated internally so frequent app switches are cheap.
                if (ExpoOneBox.getStatus() === 0 /* VPN_STATUS.STOPPED */) {
                    prefetchConfigTemplates().catch((e) => {
                        jsLog.warn('[RootLayout] prefetchConfigTemplates on active error:', e);
                    });
                    updateVerificationData(false).catch((e) => {
                        jsLog.warn('[RootLayout] updateVerificationData on active error:', e);
                    });
                }
            }
        });

        // Prefetch config templates only when VPN is stopped.
        // When VPN is running, all traffic routes through the TUN interface — HTTP requests
        // made before the tunnel is stable will hang until the 5s timeout fires.
        if (ExpoOneBox.getStatus() === 0 /* VPN_STATUS.STOPPED */) {
            prefetchConfigTemplates().catch((e) => {
                jsLog.warn('[RootLayout] prefetchConfigTemplates error:', e);
            });
        }

        // 需要每次启动都确保缓存数据库就位
        copyCacheDb().then(() => {
            jsLog.info('[RootLayout] cache.db copy complete on subsequent launch');
        }).catch((e) => {
            jsLog.warn('[RootLayout] cache.db copy error on subsequent launch:', e);
        });

        if (AppLaunchFlags.isFirstLaunch()) {
            runFirstLaunchSetup();
        }

        return () => appStateSub.remove();
    }, []);

    const appTree = (
        <DatabaseProvider>
            <GestureHandlerRootView style={{ flex: 1 }}>
                <StatusBar style="auto" />
                <BottomSheetModalProvider>
                    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
                        <VpnProvider>
                            <Stack screenOptions={{ headerShown: false }}>
                                <Stack.Screen name="(tabs)" options={{ headerShown: false, title: '主页' }} />
                                <Stack.Screen
                                    name="config"
                                    options={{
                                        headerShown: false,
                                        presentation: 'card',
                                        animation: 'slide_from_right',
                                    }}
                                />
                                {/* Dev-only diagnostic reached via `oneoh-networktools://dev-smoke`.
                                    Shipping the route in production is harmless — there is no UI
                                    that navigates to it; only the Makefile's post-`run-*` deep link
                                    opens it. */}
                                <Stack.Screen
                                    name="dev-smoke"
                                    options={{
                                        headerShown: false,
                                        presentation: 'card',
                                        animation: 'slide_from_bottom',
                                    }}
                                />
                            </Stack>
                        </VpnProvider>
                    </ThemeProvider>
                </BottomSheetModalProvider>
            </GestureHandlerRootView>
        </DatabaseProvider>
    );

    if (!ErrorBoundary) return appTree;

    return (
        <ErrorBoundary FallbackComponent={BugsnagErrorView}>
            {appTree}
        </ErrorBoundary>
    );
}
