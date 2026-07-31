import { useHairlineColor } from '@/constants/ios26-palette';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

export enum SignalLevel {
    None = 0,
    Weak = 1,
    Medium = 2,
    Strong = 3,
    Full = 4,
}

const TOTAL_BARS = 4;

const GOOD = '#3AAE60';
const OK = '#B8862A';
const BAD = '#C04F4A';

export function getSignalLevel(delay: number): SignalLevel {
    if (delay <= 0) return SignalLevel.None;
    if (delay < 200) return SignalLevel.Full;
    if (delay < 300) return SignalLevel.Strong;
    if (delay < 800) return SignalLevel.Medium;
    return SignalLevel.Weak;
}

function levelColor(level: SignalLevel): string {
    switch (level) {
        case SignalLevel.Full:
        case SignalLevel.Strong:
            return GOOD;
        case SignalLevel.Medium:
            return OK;
        case SignalLevel.Weak:
            return BAD;
        case SignalLevel.None:
        default:
            return '';
    }
}

interface NodeSignalProps {
    delay: number;
    testing?: boolean;
    /** 数值已陈旧（由 node store 在事件应用时评估）——整体降淡显示。 */
    stale?: boolean;
}

/**
 * 四格信号强度指示器 + 等宽字体延迟读数。
 * 五个等级：None / Weak / Medium / Strong / Full。
 * 陈旧数值以次级色 + 降淡呈现，区别于新鲜等级色。
 * 纯 RN——iOS 与 Android 渲染完全一致。
 */
export function NodeSignal({ delay, testing, stale: staleProp }: NodeSignalProps) {
    const theme = useTheme();
    const hairline = useHairlineColor();

    if (testing) {
        return (
            <View style={styles.wrap}>
                <ActivityIndicator size="small" color={theme.textSecondary} />
            </View>
        );
    }

    const level = getSignalLevel(delay);
    const stale = staleProp === true && level > 0;
    const color = stale ? theme.textSecondary : levelColor(level) || theme.textSecondary;
    const lit = level;

    return (
        <View style={[styles.wrap, stale && styles.stale]}>
            <View style={styles.bars}>
                {Array.from({ length: TOTAL_BARS }).map((_, i) => (
                    <View
                        key={i}
                        style={[
                            styles.bar,
                            { height: 4 + i * 2.5 },
                            { backgroundColor: i < lit ? color : hairline },
                        ]}
                    />
                ))}
            </View>
            <Text
                style={[
                    styles.text,
                    {
                        color: lit > 0 ? color : theme.textSecondary,
                        fontFamily: Fonts?.mono,
                    },
                ]}
            >
                {lit > 0 ? `${delay}` : '—'}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 6,
        minWidth: 60,
        justifyContent: 'flex-end',
    },
    stale: {
        opacity: 0.55,
    },
    bars: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 2,
        paddingBottom: 1,
    },
    bar: {
        width: 2.5,
        borderRadius: 1,
    },
    text: {
        fontSize: 11,
        fontWeight: '600',
        letterSpacing: -0.2,
        minWidth: 24,
        textAlign: 'right',
    },
});
