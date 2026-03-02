// app/_layout.tsx
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import '../global.css';

import { useColorScheme } from 'react-native';

export default function RootLayout() {
  const colorScheme = useColorScheme()


  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>

      <Stack screenOptions={{ headerShown: false }}>
        {/* (tabs) 分组作为根堆栈的第一层 */}
        <Stack.Screen name="(tabs)" options={{ headerShown: false, title: '主页' }} />

        {/* config 目录作为平级的一层，推入时会自动覆盖 (tabs) */}
        <Stack.Screen
          name="config"
          options={{ headerShown: true, title: '配置' }}
        />
      </Stack>
    </ThemeProvider>
  );
}