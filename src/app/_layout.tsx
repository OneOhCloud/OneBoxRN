/**
 * Root layout — Stack navigator with theme-aware navigation chrome.
 * Wraps the entire app in a ThemeProvider for react-navigation dark mode support.
 */
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import '../global.css';

import { VpnProvider } from '@/contexts/vpn-context';
import { AppLaunchFlags } from '@/database/kv';
import { Asset } from 'expo-asset';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { Platform, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import ExpoOneBox from '../modules/expo-onebox';

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
            // Trigger network permission dialog (first outbound request shows the system prompt)
            await ExpoOneBox.triggerNetworkPermission();
        }

        // Copy bundled cache.db to native working directory on both platforms

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

        if (AppLaunchFlags.isFirstLaunch()) {
            runFirstLaunchSetup();
        } else {
            copyCacheDb().then(() => {
                console.log('[RootLayout] cache.db copy complete on subsequent launch');
            }).catch((e) => {
                console.warn('[RootLayout] cache.db copy error on subsequent launch:', e);
            });
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
