/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {



  light: {
    // oklch(98.5% 0.002 247.839)
    border: '#fafafa',
    cardBackground: '#ffffff',
    text: '#000000',
    background: '#f9fafb',

    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',

    // Frosted glass card
    glassBackground: 'rgba(255, 255, 255, 0.78)',
    glassBorder: 'rgba(0, 0, 0, 0.06)',
  },
  dark: {
    border: '#38383A',
    cardBackground: '#2C2C2E',
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#2C2C2E',
    backgroundSelected: '#3A3A3C',
    textSecondary: '#B0B4BA',

    // Frosted glass card — dark uses faint bright edge, no shadow
    glassBackground: 'rgba(44, 44, 46, 0.78)',
    glassBorder: 'rgba(255, 255, 255, 0.08)',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
