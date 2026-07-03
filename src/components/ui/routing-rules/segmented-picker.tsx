import { selectionChanged } from '@/components/ui/haptics';
import { useAccentBlue, useQuietChrome } from '@/constants/ios26-palette';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useEffect, useRef, useState } from 'react';
import {
    LayoutChangeEvent,
    Platform,
    Pressable,
    Text,
    View,
    useColorScheme,
} from 'react-native';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from 'react-native-reanimated';

const TRACK_PADDING = 4;

interface SegmentedOption<T extends string> {
    value: T;
    label: string;
    disabled?: boolean;
}

interface SegmentedPickerProps<T extends string> {
    options: SegmentedOption<T>[];
    value: T;
    onChange: (v: T) => void;
}

export function SegmentedPicker<T extends string>({
    options,
    value,
    onChange,
}: SegmentedPickerProps<T>) {
    const theme = useTheme();
    const isDark = useColorScheme() === 'dark';
    const accentBlue = useAccentBlue();
    const trackColor = useQuietChrome();
    const thumbColor = isDark ? 'rgba(58, 62, 75, 0.95)' : '#FFFFFF';

    const [trackWidth, setTrackWidth] = useState(0);
    const thumbWidth = trackWidth > 0 ? (trackWidth - TRACK_PADDING * 2) / options.length : 0;

    const activeIndex = Math.max(0, options.findIndex((o) => o.value === value));

    const translateX = useSharedValue(0);
    // thumb 保持透明，直到首次 layout 算出 `thumbWidth` 且写入正确的 `translateX`。
    // 没有这道 gate，Android 每次 remount 都会在位置 0 闪一帧 thumb（含阴影）。
    // 完整原因见 mode-selector.tsx。
    const opacity = useSharedValue(0);
    const hasPositioned = useRef(false);

    useEffect(() => {
        if (thumbWidth <= 0) return;
        const target = activeIndex * thumbWidth;
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
    }, [activeIndex, thumbWidth, translateX, opacity]);

    const thumbStyle = useAnimatedStyle(() => ({
        opacity: opacity.value,
        transform: [{ translateX: translateX.value }],
    }));

    const handleLayout = (e: LayoutChangeEvent) => {
        const w = e.nativeEvent.layout.width;
        if (w !== trackWidth) setTrackWidth(w);
    };

    return (
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
                        // iOS：活动槽下方一层柔和的磨砂阴影。
                        // Android：无边框、无 `elevation`。仅靠 thumbColor 填充标示
                        // 活动槽。这里禁用 `elevation` — 它的 RenderNode 阴影独立于
                        // opacity / transform 绘制，每次 remount 会在动画前的边界处
                        // 闪出一个矩形残影。
                        Platform.OS === 'ios'
                            ? {
                                  shadowColor: '#0B1628',
                                  shadowOffset: { width: 0, height: 3 },
                                  shadowOpacity: isDark ? 0.35 : 0.1,
                                  shadowRadius: 8,
                              }
                            : null,
                        thumbStyle,
                    ]}
                />
            )}
            {options.map((opt) => {
                const active = opt.value === value;
                const disabled = !!opt.disabled;
                return (
                    <Pressable
                        key={opt.value}
                        disabled={disabled}
                        onPress={() => {
                            selectionChanged();
                            onChange(opt.value);
                        }}
                        accessibilityRole="tab"
                        accessibilityState={{ selected: active, disabled }}
                        style={{
                            flex: 1,
                            alignItems: 'center',
                            justifyContent: 'center',
                            zIndex: 1,
                        }}
                    >
                        <Text
                            numberOfLines={1}
                            style={{
                                fontSize: 15,
                                fontFamily: Fonts?.rounded,
                                fontWeight: active ? '700' : '500',
                                color: disabled
                                    ? theme.textSecondary
                                    : active
                                      ? accentBlue
                                      : theme.text,
                                opacity: disabled ? 0.4 : 1,
                                letterSpacing: -0.2,
                            }}
                        >
                            {opt.label}
                        </Text>
                    </Pressable>
                );
            })}
        </View>
    );
}
