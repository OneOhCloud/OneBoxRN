import { SymbolView } from 'expo-symbols';
import { Button, Surface } from 'heroui-native';
import { PropsWithChildren, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function Collapsible({ children, title }: PropsWithChildren & { title: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const theme = useTheme();

  return (
    <ThemedView>
      <Button
        variant="ghost"
        className="justify-start px-0 py-2"
        onPress={() => setIsOpen((value) => !value)}
        animation={{
          transform: [{ rotate: isOpen ? '-90deg' : '90deg' }],
          transition: { duration: 200 }
        }}>
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
        <Animated.View entering={FadeIn.duration(200)}>
          <ThemedView type="backgroundElement" style={styles.content}>
            {children}
          </ThemedView>
        </Animated.View>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  content: {
    marginTop: Spacing.three,
    borderRadius: Spacing.three,
    padding: Spacing.three,
  },
});
marginLeft: Spacing.four,
  padding: Spacing.four,
  },
});
