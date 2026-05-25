// app/config/_layout.tsx
import { Stack } from 'expo-router';

export default function ConfigLayout() {
    return (
        <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="dev" options={{ animation: 'none' }} />
            <Stack.Screen name="logs" />
            <Stack.Screen name="view-config" />
        </Stack>
    );
}
