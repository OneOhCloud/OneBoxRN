import { SymbolView } from 'expo-symbols';
import { Button, Surface } from 'heroui-native';
import { PropsWithChildren, useState } from 'react';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';

export function Collapsible({ children, title }: PropsWithChildren & { title: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const theme = useTheme();

  return (
    <ThemedView>
      <Button
        variant="ghost"
        className="justify-start px-0 py-2"
        onPress={() => setIsOpen((value) => !value)}>
        <Surface variant="secondary" className="w-6 h-6 rounded items-center justify-center mr-2">
          <SymbolView
            name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
            size={14}
            weight="bold"
            tintColor={theme.text}
          />
        </Surface>

        <ThemedText type="small">{title}</ThemedText>
      </Button>
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
