// app/_layout.tsx
import { useColorScheme } from '@/hooks/use-color-scheme';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';

export default function RootLayout() {
  const colorScheme = useColorScheme();

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