import { Fonts } from '@/constants/theme';
import type { TaskRecord } from '@/database/kv';
import { useTheme } from '@/hooks/use-theme';
import { StyleSheet, Text, View } from 'react-native';
import { formatDuration, formatTime, taskStatusColor, triggerColor, triggerLabel } from '@/utils/dev-utils';

interface RecordRowProps {
    record: TaskRecord;
    isLast: boolean;
}

export function RecordRow({ record, isLast }: RecordRowProps) {
    const theme = useTheme();
    const color = taskStatusColor(record.status);
    const tColor = triggerColor(record.trigger);

    return (
        <View
            style={{
                paddingVertical: 10,
                borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
                borderBottomColor: theme.border,
            }}
        >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
                    <Text style={{ fontSize: 13, color: theme.text, fontFamily: Fonts?.mono }}>
                        {formatTime(record.time)}
                    </Text>
                    <Text style={{ fontSize: 10, color: tColor, fontFamily: Fonts?.mono, fontWeight: '600' }}>
                        {triggerLabel(record.trigger)}
                    </Text>
                    <Text style={{ fontSize: 10, color, fontFamily: Fonts?.mono, fontWeight: '600' }}>
                        {record.status}
                    </Text>
                    {record.contentChanged && (
                        <Text style={{ fontSize: 10, color: '#007AFF', fontFamily: Fonts?.mono, fontWeight: '600' }}>
                            updated
                        </Text>
                    )}
                </View>
                <Text style={{ fontSize: 12, color: theme.textSecondary, fontFamily: Fonts?.mono }}>
                    {formatDuration(record.duration)}
                </Text>
            </View>
            {record.detail ? (
                <Text style={{ fontSize: 12, color: theme.textSecondary, marginTop: 2, marginLeft: 12 }} numberOfLines={1}>
                    {record.detail}
                </Text>
            ) : null}
        </View>
    );
}
