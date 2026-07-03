/**
 * 根布局 — 带主题感知导航外观的 Stack navigator。
 * 用 ThemeProvider 包裹整个 app，为 react-navigation 提供深色模式支持。
 */

import { VpnProvider } from '@/contexts/vpn-context';
import { DatabaseProvider } from '@/database/sqlite3';
import { AppLaunchFlags, BugsnagCrashTestFlags, migrateV1ProfileToMulti } from '@/database/kv';
import { prefetchConfigTemplates } from '@/database/config-template';
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
import ExpoOneBox, { VPN_STATUS } from '../modules/expo-onebox';

const bugsnagApiKey = Constants.expoConfig?.extra?.bugsnag?.apiKey;
const bugsnagEnabled = typeof bugsnagApiKey === 'string' && bugsnagApiKey.length > 0;

if (bugsnagEnabled) {
    Bugsnag.start({ apiKey: bugsnagApiKey });
}

const ErrorBoundary = bugsnagEnabled
    ? Bugsnag.getPlugin('react')!.createErrorBoundary(React)
    : null;

// ---------------------------------------------------------------------------
// 首次启动初始化辅助函数
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
            // 通过 expo-notifications 申请通知权限（Android 13+ POST_NOTIFICATIONS）
            await Notifications.requestPermissionsAsync();
            // 申请电池优化豁免，让 VPN 服务在后台不受限制地运行
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
        // 非致命错误 — 记录后继续
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
        // 单配置 → 多配置格式迁移（一次性，幂等）
        migrateV1ProfileToMulti();
        runBugsnagCrashTestIfArmed();

        // 注册后台任务前，先初始化域名校验数据（拉取并缓存）
        Task.initializeConfigRefresh()
            .then(() => {
                jsLog.info('[RootLayout] config refresh initialization complete');
                // 此时校验数据已就位，注册后台任务
                Task.registerConfigRefreshTask();
            })
            .catch((e) => {
                jsLog.warn('[RootLayout] config refresh initialization error:', e);
                // 校验数据拉取失败也照样注册任务，届时使用默认值
                Task.registerConfigRefreshTask();
            });

        // 同步原生后台任务在 JS 未运行期间写入的结果
        Task.syncNativeResultToJS();

        const appStateSub = AppState.addEventListener('change', (nextState) => {
            if (nextState === 'active') {
                Task.syncNativeResultToJS();

                // 回到前台时重新预取远程资源，但仅在隧道未转发流量时进行
                // （否则请求会卡在 TUN 接口上）。两个调用内部都有 TTL 门控，
                // 所以频繁切换 app 的开销很低。
                if (ExpoOneBox.getStatus() === VPN_STATUS.STOPPED) {
                    prefetchConfigTemplates().catch((e) => {
                        jsLog.warn('[RootLayout] prefetchConfigTemplates on active error:', e);
                    });
                    updateVerificationData(false).catch((e) => {
                        jsLog.warn('[RootLayout] updateVerificationData on active error:', e);
                    });
                }
            }
        });

        // 仅在 VPN 停止时预取配置模板。
        // VPN 运行时所有流量都经 TUN 接口，隧道稳定前发出的 HTTP 请求
        // 会一直挂起，直到 5s 超时触发。
        if (ExpoOneBox.getStatus() === VPN_STATUS.STOPPED) {
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
                                {/* 仅供开发的诊断页，经 `oneoh-networktools://dev-smoke` 进入。
                                    随生产版本发布无害 — 没有任何 UI 会导航到它，只有 Makefile
                                    在 `run-*` 之后用 deep link 打开它。 */}
                                <Stack.Screen
                                    name="dev-smoke"
                                    options={{
                                        headerShown: false,
                                        presentation: 'card',
                                        animation: 'slide_from_bottom',
                                    }}
                                />
                                {/* 仅供开发的自动化 harness — oneoh-networktools://dev-harness?op=…
                                    各动作在屏幕内受 __DEV__ 门控，并输出 [[HARNESS]] logcat 标记。 */}
                                <Stack.Screen
                                    name="dev-harness"
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
