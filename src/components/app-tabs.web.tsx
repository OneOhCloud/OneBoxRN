import {
  TabList,
  TabListProps,
  Tabs,
  TabSlot,
  TabTrigger,
  TabTriggerSlotProps,
} from 'expo-router/ui';
import { SymbolView } from 'expo-symbols';
import React from 'react';
import { Pressable, useColorScheme, View } from 'react-native';

import { ExternalLink } from './external-link';
import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

import { Colors } from '@/constants/theme';

export default function AppTabs() {
  return (
    <Tabs>
      <TabSlot className="h-full" />
      <TabList asChild>
        <CustomTabList>
          <TabTrigger name="index" href="/" asChild>
            <TabButton>连接</TabButton>
          </TabTrigger>
          <TabTrigger name="monitor" href="/info" asChild>
            <TabButton>信息</TabButton>
          </TabTrigger>
          <TabTrigger name="logs" href="/logs" asChild>
            <TabButton>日志</TabButton>
          </TabTrigger>
        </CustomTabList>
      </TabList>
    </Tabs>
  );
}

export function TabButton({ children, isFocused, ...props }: TabTriggerSlotProps) {
  return (
    <Pressable className="hover:opacity-70" {...props}>
      <ThemedView
        type={isFocused ? 'backgroundSelected' : 'backgroundElement'}
        className="w-12 h-12 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-700 items-center justify-center">
        <ThemedText type="small" themeColor={isFocused ? 'text' : 'textSecondary'}>
          {children}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

export function CustomTabList(props: TabListProps) {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'unspecified' ? 'light' : scheme];

  return (
    <View className="flex-row items-center justify-center h-20 px-4 border-t border-zinc-200 dark:border-zinc-700" {...props}>
      <ThemedView className="flex-row bg-zinc-100 dark:bg-zinc-800 rounded-2xl p-1">
        <ThemedText type="smallBold" className="mr-auto">
          Expo Starter
        </ThemedText>

        {props.children}

        <ExternalLink href="https://docs.expo.dev" asChild>
          <Pressable className="flex-row justify-center items-center gap-1 ml-3">
            <ThemedText type="link">Doc</ThemedText>
            <SymbolView
              tintColor={colors.text}
              name={{ ios: 'arrow.up.right.square', web: 'link' }}
              size={12}
            />
          </Pressable>
        </ExternalLink>
      </ThemedView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// No more styles - using tailwindcss!
// ─────────────────────────────────────────────────────────────
