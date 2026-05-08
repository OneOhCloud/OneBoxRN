import { Platform, useColorScheme } from 'react-native';

// iOS 26 cool-chrome palette. Originally lived inside active-profile-card.tsx
// but is now consumed by ~7 sibling components, so it's promoted to a shared
// constants module. The file mixes raw constants and color-scheme-aware
// hooks intentionally — they describe one cohesive design system.

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

// Hairline separator color used across every iOS 26 row component.
export function useHairlineColor(): string {
    return useColorScheme() === 'dark'
        ? 'rgba(255, 255, 255, 0.10)'
        : 'rgba(11, 13, 18, 0.09)';
}

// Quiet silver-tinted chrome for pill buttons and segmented-control tracks.
export function useQuietChrome(): string {
    return useColorScheme() === 'dark'
        ? 'rgba(255, 255, 255, 0.10)'
        : 'rgba(11, 13, 18, 0.06)';
}

// Module-level frozen glass surfaces. Returning one of these from the hook
// keeps style-prop identity stable across renders so React.memo'd children
// can bail out when nothing else changed.
//
// iOS uses translucent frost + soft shadow; Android needs opaque bg because
// `elevation` silently no-ops on any view with a non-opaque backgroundColor.
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
