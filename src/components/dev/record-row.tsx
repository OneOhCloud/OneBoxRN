import { lightImpact } from '@/components/ui/haptics';
import { useHairlineColor } from '@/constants/ios26-palette';
import { Fonts, TabularNums } from '@/constants/theme';
import type { TaskRecord } from '@/database/kv';
import { useTheme } from '@/hooks/use-theme';
import { formatDuration, formatTime, methodColor, taskStatusColor, triggerColor, triggerLabel } from '@/utils/dev-utils';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

interface RecordRowProps {
    record: TaskRecord;
    isLast: boolean;
    onPress?: () => void;
}

/**
 * Compact monospaced log row — denser than the tab SettingsRow because the
 * dev screen is info-heavy, but still uses the same hairline / iOS font stack.
 */
export function RecordRow({ record, isLast, onPress }: RecordRowProps) {
    const theme = useTheme();
    const hairline = useHairlineColor();
    const statusColor = taskStatusColor(record.status);
    const tColor = triggerColor(record.trigger);

    return (
        <Pressable
            onPress={onPress ? () => { lightImpact(); onPress(); } : undefined}
            style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}
        >
            <View style={{ paddingVertical: 10, paddingHorizontal: 16, gap: 3 }}>
                {/* Row 1: time (left) + duration + chevron (right) */}
                <View
                    style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                    }}
                >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <View
                            style={{
                                width: 7,
                                height: 7,
                                borderRadius: 3.5,
                                backgroundColor: statusColor,
                            }}
                        />
                        <Text
                            style={{
                                fontSize: 13,
                                color: theme.text,
                                fontFamily: Fonts?.mono,
                                fontVariant: TabularNums,
                                letterSpacing: -0.1,
                            }}
                        >
                            {formatTime(record.time)}
                        </Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text
                            style={{
                                fontSize: 12,
                                color: theme.textSecondary,
                                fontFamily: Fonts?.mono,
                                fontVariant: TabularNums,
                            }}
                        >
                            {formatDuration(record.duration)}
                        </Text>
                        {onPress && (
                            <Ionicons name="chevron-forward" size={14} color={theme.textSecondary} />
                        )}
                    </View>
                </View>
                {/* Row 2: trigger + status + updated badge */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 13 }}>
                    <Text
                        style={{
                            fontSize: 10,
                            color: tColor,
                            fontFamily: Fonts?.mono,
                            fontWeight: '700',
                            letterSpacing: 0.3,
                            textTransform: 'uppercase',
                        }}
                    >
                        {triggerLabel(record.trigger)}
                    </Text>
                    <Text
                        style={{
                            fontSize: 10,
                            color: methodColor(record.method),
                            fontFamily: Fonts?.mono,
                            fontWeight: '700',
                            letterSpacing: 0.3,
                            textTransform: 'uppercase',
                        }}
                    >
                        {record.method}
                    </Text>
                    <Text
                        style={{
                            fontSize: 10,
                            color: statusColor,
                            fontFamily: Fonts?.mono,
                            fontWeight: '700',
                            letterSpacing: 0.3,
                            textTransform: 'uppercase',
                        }}
                    >
                        {record.status}
                    </Text>
                    {record.contentChanged && (
                        <Text
                            style={{
                                fontSize: 10,
                                color: '#007AFF',
                                fontFamily: Fonts?.mono,
                                fontWeight: '700',
                                letterSpacing: 0.3,
                                textTransform: 'uppercase',
                            }}
                        >
                            updated
                        </Text>
                    )}
                    {record.error ? (
                        <Text
                            style={{
                                fontSize: 10,
                                color: theme.textSecondary,
                                fontFamily: Fonts?.mono,
                                flexShrink: 1,
                            }}
                            numberOfLines={1}
                        >
                            {record.error}
                        </Text>
                    ) : null}
                </View>
            </View>
            {!isLast && (
                <View
                    style={{
                        height: StyleSheet.hairlineWidth,
                        marginLeft: 32,
                        backgroundColor: hairline,
                    }}
                />
            )}
        </Pressable>
    );
}
