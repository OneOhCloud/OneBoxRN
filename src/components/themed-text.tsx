import { Platform, Text, type TextProps } from 'react-native';

import { ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?: 'default' | 'title' | 'small' | 'smallBold' | 'subtitle' | 'link' | 'linkPrimary' | 'code';
  themeColor?: ThemeColor;
};

export function ThemedText({
  style,
  type = 'default',
  themeColor,
  className = '',
  ...rest
}: ThemedTextProps & { className?: string }) {
  const theme = useTheme();

  const typeClassMap = {
    default: 'text-base leading-6 font-medium',
    title: 'text-5xl font-semibold leading-[52px]',
    small: 'text-sm leading-5 font-medium',
    smallBold: 'text-sm leading-5 font-bold',
    subtitle: 'text-3xl leading-11 font-semibold',
    link: 'text-sm leading-8',
    linkPrimary: 'text-sm leading-8 text-blue-500',
    code: 'text-xs font-mono font-medium',
  };

  const combinedClassName = `${typeClassMap[type]} ${className}`.trim();

  return (
    <Text
      className={combinedClassName}
      style={[
        {
          color: theme[themeColor ?? 'text'],
          ...(type === 'code' && Platform.select({ android: { fontWeight: '700' } }))
        },
        style,
      ]}
      {...rest}
    />
  );
}

// ─────────────────────────────────────────────────────────────
// 不再使用 StyleSheet —— 全部改用 tailwindcss！
// ─────────────────────────────────────────────────────────────
