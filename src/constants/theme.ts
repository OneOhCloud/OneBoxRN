/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform, type TextStyle } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

// iOS uses translucent frosted surfaces; Android uses solid white. Both
// platforms share the same page background (Apple's systemGroupedBackground
// tone) so the Settings/Profiles pages look identical across devices.
const GLASS_BG_LIGHT = Platform.select({ ios: 'rgba(255, 255, 255, 0.78)', default: '#FFFFFF' })!;
const GLASS_BG_DARK  = Platform.select({ ios: 'rgba(44, 44, 46, 0.78)',    default: '#1C1C1E' })!;

export const Colors = {



  light: {
    // oklch(98.5% 0.002 247.839)
    border: '#fafafa',
    cardBackground: '#ffffff',
    text: '#000000',
    // iOS systemGroupedBackground in light mode — cool enough for
    // Android white cards to separate by color alone.
    background: '#F2F2F7',

    // Must be visibly darker than `background` (#F2F2F7) so secondary
    // buttons, inputs, and quiet chrome stand out. #F0F0F3 was too close
    // to the page bg and rendered as invisible chrome.
    backgroundElement: '#E4E6EC',
    backgroundSelected: '#D8DAE0',
    textSecondary: '#60646C',

    // Frosted glass card
    glassBackground: GLASS_BG_LIGHT,
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
    glassBackground: GLASS_BG_DARK,
    glassBorder: 'rgba(255, 255, 255, 0.08)',
  },
} as const;

// `fontVariant: ['tabular-nums']` is iOS-only. On Android it is silently
// dropped, so numeric columns jitter on refresh. Use this constant everywhere
// we previously hardcoded the array.
export const TabularNums: TextStyle['fontVariant'] = Platform.select({
  ios: ['tabular-nums'],
  default: undefined,
});

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

export const MaxContentWidth = 800;

// Which safe-area edges each tab screen should consume.
//
// iOS: UITabBarController injects (tabBarHeight + homeIndicator) as
//   `additionalSafeAreaInsets.bottom`, so we must apply it as padding to
//   keep content above the translucent tab bar.
// Android: Material3 BottomNavigationBar is a sibling in the NativeTabs
//   layout — the screen's actual bottom edge is already the tab bar's top
//   edge. react-native-safe-area-context still reports the window-level
//   gesture-nav inset at the bottom (which lives *below* the tab bar,
//   outside the screen frame), and applying it creates a dead gap between
//   content and the tab bar. Dropping `bottom` fixes that.
export const TabScreenEdges: readonly Edge[] = Platform.select({
    ios: ['top', 'bottom'],
    default: ['top'],
})!;
