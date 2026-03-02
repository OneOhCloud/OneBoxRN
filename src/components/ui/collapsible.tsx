import { SymbolView } from 'expo-symbols';
import { PropsWithChildren, useState } from 'react';
import { Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';

export function Collapsible({ children, title }: PropsWithChildren & { title: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const theme = useTheme();

  return (
    <ThemedView>
      <Pressable
        onPress={() => setIsOpen((value) => !value)}
        className="flex-row items-center justify-start px-0 py-2 active:opacity-70"
      >
        <View className="w-6 h-6 rounded items-center justify-center mr-2 bg-gray-100">
          <SymbolView
            name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
            size={14}
            weight="bold"
            tintColor={theme.text}
            style={{
              transform: [{ rotate: isOpen ? '90deg' : '0deg' }]
            }}
          />
        </View>

        <ThemedText type="small">{title}</ThemedText>
      </Pressable>
      {isOpen && (
        <View>
          <ThemedView type="backgroundElement" className="mt-3 rounded-3xl p-3">
            {children}
          </ThemedView>
        </View>
      )}
    </ThemedView>
  );
}

// ─────────────────────────────────────────────────────────────
// No more styles - using tailwindcss!
// ─────────────────────────────────────────────────────────────
