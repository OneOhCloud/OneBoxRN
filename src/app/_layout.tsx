/**
 * Root layout — Stack navigator with theme-aware navigation chrome.
 * Wraps the entire app in a ThemeProvider for react-navigation dark mode support.
 */
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import '../global.css';

import { AppLaunchFlags } from '@/database/kv';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';
import { useEffect } from 'react';
import { Platform, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import ExpoOneBox from '../modules/expo-onebox';

// ---------------------------------------------------------------------------
// First-launch initialization helper
// ---------------------------------------------------------------------------

async function copyCacheDb() {
    try {
        const destPath = ExpoOneBox.getCacheDbPath();
        if (!destPath) return;

        // Skip if the file already exists (only copy once)
        const destInfo = await FileSystem.getInfoAsync('file://' + destPath);
        if (destInfo.exists) return;

        // Resolve the bundled asset to a local URI
        const [asset] = await Asset.loadAsync(require('../../assets/data/cache.db'));
        if (!asset.localUri) return;

        await FileSystem.copyAsync({
            from: asset.localUri,
            to: 'file://' + destPath,
        });
        console.log('[FirstLaunch] cache.db copied to', destPath);
    } catch (e) {
        console.warn('[FirstLaunch] copyCacheDb error:', e);
    }
}

async function runFirstLaunchSetup() {
    try {
        if (Platform.OS === 'android') {
            // Request notification permission (Android 13+ POST_NOTIFICATIONS)
            await ExpoOneBox.requestNotificationPermission();
        } else if (Platform.OS === 'ios') {
            // Trigger network permission dialog (first outbound request shows the system prompt)
            await ExpoOneBox.triggerNetworkPermission();
        }

        // Copy bundled cache.db to native working directory on both platforms
        await copyCacheDb();
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
        }
    }, []);

    return (
        <GestureHandlerRootView style={{ flex: 1 }}>
            <BottomSheetModalProvider>
                <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
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
                </ThemeProvider>
            </BottomSheetModalProvider>
        </GestureHandlerRootView>
    );
}
