/**
 * Root layout — Stack navigator with theme-aware navigation chrome.
 * Wraps the entire app in a ThemeProvider for react-navigation dark mode support.
 */
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import '../global.css';

import { useColorScheme } from 'react-native';

export default function RootLayout() {
    const colorScheme = useColorScheme();

    return (
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
    );
}
