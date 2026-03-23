/**
 * Root layout — Stack navigator with theme-aware navigation chrome.
 * Wraps the entire app in a ThemeProvider for react-navigation dark mode support.
 */

import * as TaskManager from 'expo-task-manager';

import { VpnProvider } from '@/contexts/vpn-context';
import { AppLaunchFlags, PendingTrigger } from '@/database/kv';
import * as Task from '@/tasks/config-refresh';
import { fetchWithTimeout } from '@/utils';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Asset } from 'expo-asset';
import * as Notifications from 'expo-notifications';
import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { AppState, Platform, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import '../global.css';
import ExpoOneBox from '../modules/expo-onebox';

TaskManager.defineTask(Task.CONFIG_REFRESH_TASK, async () => {
    const trigger = PendingTrigger.consume();
    return Task.executeConfigRefresh(trigger);
});



// 监听 App 状态切换
AppState.addEventListener('change', async (nextAppState) => {
    if (nextAppState === 'background') {
        const result = await Task.executeConfigRefresh('manual-direct');
        console.log(`[AppState] manual config refresh on backgrounding: ${result}`);
    }
});

// ─── Task Definition ─────────────────────────────────────────────────────────
// Must be called at module top level (outside any component).


// ---------------------------------------------------------------------------
// First-launch initialization helper
// ---------------------------------------------------------------------------

async function copyCacheDb() {
    try {
        const [asset] = await Asset.loadAsync(require('../../assets/data/tun.db'));
        if (!asset.localUri) return;
        const copied = await ExpoOneBox.copy2CacheDbPath(asset.localUri);
        if (copied) {
            console.log('[copyCacheDb] tun.db copied successfully');
        } else {
            console.log('[copyCacheDb] tun.db already exists, skipped');
        }
    } catch (e) {
        console.warn('[copyCacheDb] error:', e);
    }
}

async function runFirstLaunchSetup() {
    try {
        if (Platform.OS === 'android') {
            // Request notification permission via expo-notifications (Android 13+ POST_NOTIFICATIONS)
            await Notifications.requestPermissionsAsync();
        } else if (Platform.OS === 'ios') {
            // 苹果的网络权限需要在 app 运行时通过实际请求触发，无法通过静态清单声明或安装时授权，因此我们在首次启动时发出一个请求来触发权限对话框。
            fetchWithTimeout('https://www.apple.com/library/test/success.html').then(() => {
                console.log('[RootLayout] network permission check complete');
            }).catch((e) => {
                console.warn('[RootLayout] network permission check error:', e);
            });
        }
    } catch (e) {
        // Non-fatal — log and continue
        console.warn('[FirstLaunch] setup error:', e);
    } finally {
        AppLaunchFlags.markFirstLaunchDone();
    }
}

// ---------------------------------------------------------------------------

export default function RootLayout() {
    const colorScheme = useColorScheme();
    useEffect(() => {
        const updateTask = async () => {
            await Task.registerConfigRefreshTask();
        };
        updateTask()
    }, []);
    useEffect(() => {
        // 需要每次启动都确保缓存数据库就位
        copyCacheDb().then(() => {
            console.log('[RootLayout] cache.db copy complete on subsequent launch');
        }).catch((e) => {
            console.warn('[RootLayout] cache.db copy error on subsequent launch:', e);
        });


        if (AppLaunchFlags.isFirstLaunch()) {
            runFirstLaunchSetup();
        }


    }, []);

    return (
        <GestureHandlerRootView style={{ flex: 1 }}>
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
                        </Stack>
                    </VpnProvider>
                </ThemeProvider>
            </BottomSheetModalProvider>
        </GestureHandlerRootView>
    );
}
