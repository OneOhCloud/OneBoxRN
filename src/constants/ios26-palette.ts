import { Platform, useColorScheme } from 'react-native';

// iOS 26 冷色 chrome 配色。被约 7 个同级组件共用，故放在共享的 constants
// 模块里。文件有意混放裸常量与随配色方案变化的 hook —— 它们共同描述一套
// 内聚的设计系统。

export const ACCENT        = '#0A84FF';
export const ACCENT_LIGHT  = '#007AFF';
export const WARN          = '#FF9F0A';
export const ALERT         = '#FF453A';
export const SILVER_LIGHT  = '#D1D5DB';
export const SILVER_DARK   = '#3A3E4B';

export function useAccentBlue(): string {
    return useColorScheme() === 'dark' ? ACCENT : ACCENT_LIGHT;
}

export function useSilver(): string {
    return useColorScheme() === 'dark' ? SILVER_DARK : SILVER_LIGHT;
}

// 所有 iOS 26 行组件共用的极细分隔线颜色。
export function useHairlineColor(): string {
    return useColorScheme() === 'dark'
        ? 'rgba(255, 255, 255, 0.10)'
        : 'rgba(11, 13, 18, 0.09)';
}

// 用于胶囊按钮与分段控件轨道的安静银灰 chrome。
export function useQuietChrome(): string {
    return useColorScheme() === 'dark'
        ? 'rgba(255, 255, 255, 0.10)'
        : 'rgba(11, 13, 18, 0.06)';
}

// 模块级的冻结玻璃表面。hook 返回其中之一，可让 style prop 的引用在多次
// 渲染间保持稳定，从而在别无变化时让 React.memo 的子组件跳过重渲染。
//
// iOS 用半透明磨砂 + 柔和阴影；Android 需要不透明背景，因为对任何
// backgroundColor 非不透明的视图，`elevation` 会静默失效。
const GLASS_LIGHT = Platform.select({
    ios: {
        backgroundColor: 'rgba(255, 255, 255, 0.78)',
        borderRadius: 22,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.95)',
        shadowColor: '#0B1628',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.08,
        shadowRadius: 24,
    },
    default: {
        backgroundColor: '#FFFFFF',
        borderRadius: 22,
    },
})!;

const GLASS_DARK = Platform.select({
    ios: {
        backgroundColor: 'rgba(28, 32, 42, 0.72)',
        borderRadius: 22,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.08)',
        shadowColor: '#0B1628',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.35,
        shadowRadius: 24,
    },
    default: {
        backgroundColor: '#1C1C1E',
        borderRadius: 22,
    },
})!;

export function useGlassSurface() {
    return useColorScheme() === 'dark' ? GLASS_DARK : GLASS_LIGHT;
}
