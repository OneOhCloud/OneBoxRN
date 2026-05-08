import { selectionChanged } from '@/components/ui/haptics';
import { useAccentBlue } from '@/constants/ios26-palette';
import i18n from '@/constants/language';
import { Fonts } from '@/constants/theme';
import { useVpn } from '@/contexts/vpn-context';
import { useTheme } from '@/hooks/use-theme';
import React, { useEffect, useRef, useState } from 'react';
import { LayoutChangeEvent, Platform, Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from 'react-native-reanimated';

const OPTIONS = [
    { labelKey: 'mode_rules', value: 'tun-rules' as const },
    { labelKey: 'mode_global', value: 'tun-global' as const },
];

const TRACK_PADDING = 4;

export function ModeSelector() {
    const theme = useTheme();
    const isDark = useColorScheme() === 'dark';
    const { mode, setMode } = useVpn();
    const accentBlue = useAccentBlue();
    const trackColor = theme.background;
    const thumbColor = isDark ? 'rgba(58, 62, 75, 0.95)' : '#FFFFFF';

    const [trackWidth, setTrackWidth] = useState(0);
    const thumbWidth = trackWidth > 0 ? (trackWidth - TRACK_PADDING * 2) / OPTIONS.length : 0;

    const translateX = useSharedValue(0);
    // The thumb stays fully transparent until the first layout pass has
    // computed `thumbWidth` AND we've written the correct `translateX` for
    // the current mode. Without this gate, Android shows a single frame of
    // the thumb (+ its elevation shadow) at the default position 0 on every
    // remount — most noticeably when switching from the Home tab to the
    // Profiles tab, which looked like "a rectangular ghost sliding in".
    const opacity = useSharedValue(0);
    const hasPositioned = useRef(false);

    useEffect(() => {
        if (thumbWidth <= 0) return;
        const idx = Math.max(0, OPTIONS.findIndex(o => o.value === mode));
        const target = idx * thumbWidth;
        if (!hasPositioned.current) {
            hasPositioned.current = true;
            translateX.value = target;
            opacity.value = 1;
            return;
        }
        translateX.value = withSpring(target, {
            damping: 18,
            stiffness: 220,
            mass: 0.9,
        });
    }, [mode, thumbWidth, translateX, opacity]);

    const thumbStyle = useAnimatedStyle(() => ({
        opacity: opacity.value,
        transform: [{ translateX: translateX.value }],
    }));

    const handleLayout = (e: LayoutChangeEvent) => {
        const w = e.nativeEvent.layout.width;
        if (w !== trackWidth) setTrackWidth(w);
    };

    return (
        <View>
            <View
                style={{
                    flexDirection: 'row',
                    padding: TRACK_PADDING,
                    backgroundColor: trackColor,
                    borderRadius: 14,
                    height: 44,
                    position: 'relative',
                }}
                accessibilityRole="tablist"
                onLayout={handleLayout}
            >
                {thumbWidth > 0 && (
                    <Animated.View
                        pointerEvents="none"
                        style={[
                            {
                                position: 'absolute',
                                top: TRACK_PADDING,
                                bottom: TRACK_PADDING,
                                left: TRACK_PADDING,
                                width: thumbWidth,
                                borderRadius: 11,
                                backgroundColor: thumbColor,
                            },
                            // iOS: soft frosted shadow under the active slot.
                            // Android: DO NOT use `elevation`. The RenderNode
                            // shadow is drawn independently of the view's
                            // opacity / transform on Android and flashes a
                            // rectangular ghost at the pre-animation bounds
                            // on every remount (e.g. switching tabs). A
                            // hairline stroke + slightly lifted fill gives an
                            // equivalent "raised chip" read without touching
                            // the shadow compositor at all.
                            Platform.OS === 'ios'
                                ? {
                                      shadowColor: '#0B1628',
                                      shadowOffset: { width: 0, height: 3 },
                                      shadowOpacity: isDark ? 0.35 : 0.10,
                                      shadowRadius: 8,
                                  }
                                : {
                                      borderWidth: StyleSheet.hairlineWidth,
                                      borderColor: isDark
                                          ? 'rgba(255,255,255,0.12)'
                                          : 'rgba(11,13,18,0.08)',
                                  },
                            thumbStyle,
                        ]}
                    />
                )}
                {OPTIONS.map((opt) => {
                    const active = mode === opt.value;
                    return (
                        <Pressable
                            key={opt.value}
                            onPress={() => { selectionChanged(); setMode(opt.value); }}
                            accessibilityRole="tab"
                            accessibilityState={{ selected: active }}
                            style={{
                                flex: 1,
                                alignItems: 'center',
                                justifyContent: 'center',
                                zIndex: 1,
                            }}
                        >
                            <Text
                                style={{
                                    fontSize: 15,
                                    fontFamily: Fonts?.rounded,
                                    fontWeight: active ? '700' : '500',
                                    color: active ? accentBlue : theme.text,
                                    letterSpacing: -0.2,
                                }}
                            >
                                {i18n.t(opt.labelKey)}
                            </Text>
                        </Pressable>
                    );
                })}
            </View>

            <Text
                style={{
                    fontSize: 12,
                    fontFamily: Fonts?.sans,
                    color: theme.textSecondary,
                    marginTop: 10,
                    marginHorizontal: 4,
                    lineHeight: 16,
                }}
            >
                {i18n.t(mode === 'tun-rules' ? 'mode_desc_rules' : 'mode_desc_global')}
            </Text>
        </View>
    );
}
