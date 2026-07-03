/**
 * 以下是应用使用的配色，分别定义了浅色与深色模式。
 * 给应用做样式还有很多别的方式，例如 [Nativewind](https://www.nativewind.dev/)、[unistyles](https://reactnativeunistyles.vercel.app) 等。
 */

import '@/global.css';

import { Platform, type TextStyle } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

// iOS 用半透明磨砂表面，Android 用纯白。两个平台共用同一页面背景（Apple 的
// systemGroupedBackground 色调），使 设置/配置文件 页在不同设备上看起来一致。
const GLASS_BG_LIGHT = Platform.select({ ios: 'rgba(255, 255, 255, 0.78)', default: '#FFFFFF' })!;
const GLASS_BG_DARK  = Platform.select({ ios: 'rgba(44, 44, 46, 0.78)',    default: '#1C1C1E' })!;

export const Colors = {



  light: {
    // oklch(98.5% 0.002 247.839)
    border: '#fafafa',
    cardBackground: '#ffffff',
    text: '#000000',
    // 浅色模式下的 iOS systemGroupedBackground —— 足够冷，让 Android 的白色
    // 卡片仅靠颜色就能区分开。
    background: '#F2F2F7',

    // 必须明显比 `background`(#F2F2F7) 深，否则太接近页面背景，次级按钮、
    // 输入框和安静的 chrome 会淡成看不见。
    backgroundElement: '#E4E6EC',
    backgroundSelected: '#D8DAE0',
    textSecondary: '#60646C',

    // 磨砂玻璃卡片
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

    // 磨砂玻璃卡片 —— 深色用微亮边缘，无阴影
    glassBackground: GLASS_BG_DARK,
    glassBorder: 'rgba(255, 255, 255, 0.08)',
  },
} as const;

// `fontVariant: ['tabular-nums']` 只在 iOS 生效。Android 会静默丢弃它，导致
// 数字列在刷新时抖动。凡是需要该数组的地方都用这个常量。
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

// 每个 tab 屏应当消费哪些安全区边缘。
//
// iOS：UITabBarController 会把 (tabBarHeight + homeIndicator) 注入到
//   `additionalSafeAreaInsets.bottom`，因此必须把它作为 padding 应用，
//   让内容留在半透明 tab bar 之上。
// Android：Material3 BottomNavigationBar 在 NativeTabs 布局里是同级 —— 屏幕
//   实际的底边就已经是 tab bar 的顶边。react-native-safe-area-context 仍会在
//   底部报告窗口级的手势导航 inset（它位于 tab bar *下方*、屏幕框之外），
//   应用它会在内容与 tab bar 之间留出一段死空隙。去掉 `bottom` 即可修正。
export const TabScreenEdges: readonly Edge[] = Platform.select({
    ios: ['top', 'bottom'],
    default: ['top'],
})!;
