import { useSyncExternalStore } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

const emptySubscribe = () => () => {};

/**
 * 为支持静态渲染，web 上该值需在客户端重新计算。`useSyncExternalStore` 在
 * SSR/hydration 期间返回 server 快照（'light'），在每次客户端渲染返回客户端
 * 快照 —— 无需挂载后 setState。
 */
export function useColorScheme() {
  const hasHydrated = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

  const colorScheme = useRNColorScheme();

  if (hasHydrated) {
    return colorScheme;
  }

  return 'light';
}
