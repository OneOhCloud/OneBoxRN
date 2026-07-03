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
    // thumb 保持完全透明，直到首次 layout 算出 `thumbWidth` 且已为当前 mode
    // 写入正确的 `translateX`。没有这道闸，Android 每次 remount 都会在默认
    // 位置 0 闪现一帧 thumb（连同它的 elevation 阴影）——从 Home tab 切到
    // Profiles tab 时最明显，看起来像"一个矩形残影滑入"。
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
                            // iOS：活动槽位下方的柔和磨砂阴影。
                            // Android：切勿使用 `elevation`。RenderNode 阴影在
                            // Android 上独立于视图的 opacity / transform 绘制，
                            // 每次 remount（如切换 tab）都会在动画前的边界处
                            // 闪现一个矩形残影。改用 hairline 描边 + 略微抬升的
                            // 填充色，能得到等效的"抬起芯片"观感，且完全不触碰
                            // 阴影合成器。
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
