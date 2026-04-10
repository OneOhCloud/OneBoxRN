import type { TaskRecord } from '@/database/kv';
import { useTheme } from '@/hooks/use-theme';
import { Fonts, Spacing } from '@/constants/theme';
import i18n from '@/constants/language';
import { Alert, Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';

interface TaskDetailModalProps {
    record: TaskRecord | null;
    visible: boolean;
    onClose: () => void;
}

export function TaskDetailModal({ record, visible, onClose }: TaskDetailModalProps) {
    const theme = useTheme();

    if (!record) return null;

    const statusColor = record.status === 'success' ? '#34C759' : record.status === 'failed' ? '#FF3B30' : '#FF9500';

    const copyToClipboard = async (text: string, label: string) => {
        try {
            await Clipboard.setStringAsync(text);
            Alert.alert(i18n.t('task_copied', { label }), text);
        } catch (e) {
            Alert.alert(i18n.t('task_copy_failed'), String(e));
        }
    };

    return (
        <Modal
            visible={visible}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={onClose}
        >
            <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
                {/* Header */}
                <View
                    style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        paddingHorizontal: Spacing.four,
                        paddingVertical: Spacing.three,
                        borderBottomWidth: 1,
                        borderBottomColor: theme.border,
                    }}
                >
                    <Text style={{ fontSize: 17, fontWeight: '600', color: theme.text }}>
                        {i18n.t('task_detail_title')}
                    </Text>
                    <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Text style={{ fontSize: 18, color: theme.textSecondary }}>✕</Text>
                    </TouchableOpacity>
                </View>

                {/* Content */}
                <ScrollView
                    style={{ flex: 1 }}
                    contentContainerStyle={{
                        paddingHorizontal: Spacing.four,
                        paddingVertical: Spacing.three,
                    }}
                >
                    {/* Status & Timing */}
                    <DetailSection>
                        <DetailRow label={i18n.t('task_status')} value={record.status.toUpperCase()} valueColor={statusColor} />
                        <DetailRow label={i18n.t('task_time')} value={formatTime(record.time)} />
                        <DetailRow label={i18n.t('task_duration')} value={formatDuration(record.duration)} />
                        <DetailRow
                            label={i18n.t('task_method')}
                            value={getMethodLabel(record.method)}
                            valueColor={getMethodColor(record.method)}
                        />
                        <DetailRow label={i18n.t('task_config_updated')} value={record.contentChanged ? i18n.t('task_yes') : i18n.t('task_no')} isLast />
                    </DetailSection>

                    {/* URLs */}
                    {(record.primaryUrl || record.acceleratedUrl) && (
                        <DetailSection title={i18n.t('task_request_urls')}>
                            {record.primaryUrl && (
                                <URLRow
                                    label={i18n.t('task_primary_url')}
                                    url={record.primaryUrl}
                                    onCopy={() => copyToClipboard(record.primaryUrl!, i18n.t('task_primary_url'))}
                                    isLast={!record.acceleratedUrl}
                                    color="#34C759"
                                />
                            )}
                            {record.acceleratedUrl && (
                                <URLRow
                                    label={i18n.t('task_accelerated_url')}
                                    url={record.acceleratedUrl}
                                    onCopy={() => copyToClipboard(record.acceleratedUrl!, i18n.t('task_accelerated_url'))}
                                    isLast
                                    color="#FF9500"
                                />
                            )}
                        </DetailSection>
                    )}

                    {/* Subscription Info — raw header + traffic */}
                    {record.status === 'success' && (record.subscriptionUserinfoHeader || record.total > 0) && (
                        <DetailSection title={i18n.t('task_subscription_info')}>
                            {record.subscriptionUserinfoHeader && (
                                <TouchableOpacity
                                    onPress={() => copyToClipboard(record.subscriptionUserinfoHeader!, i18n.t('task_raw_header'))}
                                    style={{
                                        paddingHorizontal: Spacing.three,
                                        paddingVertical: Spacing.two,
                                        borderBottomWidth: 1,
                                        borderBottomColor: theme.border,
                                    }}
                                >
                                    <Text style={{
                                        fontSize: 11,
                                        color: theme.textSecondary,
                                        fontWeight: '600',
                                        marginBottom: Spacing.one,
                                    }}>
                                        {i18n.t('task_raw_header')} ({i18n.t('task_tap_to_copy')})
                                    </Text>
                                    <View style={{
                                        backgroundColor: theme.backgroundElement,
                                        padding: Spacing.two,
                                        borderRadius: 6,
                                    }}>
                                        <Text style={{
                                            fontSize: 10,
                                            color: theme.text,
                                            fontFamily: Fonts?.mono,
                                            lineHeight: 14,
                                        }}>
                                            {record.subscriptionUserinfoHeader}
                                        </Text>
                                    </View>
                                </TouchableOpacity>
                            )}
                            <DetailRow label={i18n.t('task_upload')} value={formatBytes(record.upload)} />
                            <DetailRow label={i18n.t('task_download')} value={formatBytes(record.download)} />
                            <DetailRow label={i18n.t('task_total')} value={formatBytes(record.total)} />
                            <DetailRow label={i18n.t('task_expire')} value={formatExpire(record.expire)} isLast />
                        </DetailSection>
                    )}

                    {/* Error Info */}
                    {record.error && record.status === 'failed' && (
                        <DetailSection title={i18n.t('task_error_info')}>
                            <TouchableOpacity
                                onPress={() => copyToClipboard(record.error!, i18n.t('task_error_info'))}
                                style={{ paddingVertical: Spacing.two }}
                            >
                                <View style={{
                                    backgroundColor: theme.backgroundElement,
                                    padding: Spacing.two,
                                    borderRadius: 6,
                                    borderLeftWidth: 3,
                                    borderLeftColor: '#FF3B30',
                                }}>
                                    <Text style={{
                                        fontSize: 11,
                                        color: theme.text,
                                        fontFamily: Fonts?.mono,
                                        lineHeight: 14,
                                    }}>
                                        {record.error}
                                    </Text>
                                </View>
                                <Text style={{
                                    fontSize: 10,
                                    color: theme.textSecondary,
                                    marginTop: Spacing.one,
                                }}>
                                    {i18n.t('task_tap_to_copy')}
                                </Text>
                            </TouchableOpacity>
                        </DetailSection>
                    )}

                    <View style={{ height: Spacing.four }} />
                </ScrollView>
            </SafeAreaView>
        </Modal>
    );
}

// ─── Helper Components ───────────────────────────────────────────────────────

function DetailSection({ title, children }: { title?: string; children: React.ReactNode }) {
    const theme = useTheme();
    return (
        <View style={{ marginBottom: Spacing.four }}>
            {title ? (
                <Text style={{
                    fontSize: 11,
                    fontWeight: '600',
                    color: '#999',
                    marginBottom: Spacing.two,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                }}>
                    {title}
                </Text>
            ) : null}
            <View style={{
                backgroundColor: theme.background,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: theme.border,
            }}>
                {children}
            </View>
        </View>
    );
}

function DetailRow({ label, value, valueColor, isLast }: {
    label: string;
    value: string;
    valueColor?: string;
    isLast?: boolean;
}) {
    const theme = useTheme();
    return (
        <View
            style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingHorizontal: Spacing.three,
                paddingVertical: Spacing.two,
                borderBottomWidth: isLast ? 0 : 1,
                borderBottomColor: theme.border,
            }}
        >
            <Text style={{ fontSize: 13, color: theme.text }}>{label}</Text>
            <Text style={{
                fontSize: 13,
                color: valueColor || theme.text,
                fontWeight: '500',
                fontFamily: Fonts?.mono,
            }}>
                {value}
            </Text>
        </View>
    );
}

function URLRow({ label, url, onCopy, color, isLast }: {
    label: string;
    url: string;
    onCopy: () => void;
    color: string;
    isLast?: boolean;
}) {
    const theme = useTheme();
    return (
        <TouchableOpacity
            onPress={onCopy}
            style={{
                paddingHorizontal: Spacing.three,
                paddingVertical: Spacing.two,
                borderBottomWidth: isLast ? 0 : 1,
                borderBottomColor: theme.border,
            }}
        >
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.one }}>
                <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: color, marginRight: Spacing.one }} />
                <Text style={{ fontSize: 11, color: theme.textSecondary, fontWeight: '600' }}>
                    {label} ({i18n.t('task_tap_to_copy')})
                </Text>
            </View>
            <Text
                style={{ fontSize: 11, color: theme.text, fontFamily: Fonts?.mono, lineHeight: 14 }}
                numberOfLines={3}
            >
                {url}
            </Text>
        </TouchableOpacity>
    );
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function formatTime(timestamp: string): string {
    try {
        return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
        return '—';
    }
}

function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

function formatBytes(bytes: number): string {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

function formatExpire(timestamp: number): string {
    if (!timestamp || timestamp === 0) return '—';
    try {
        return new Date(timestamp * 1000).toLocaleDateString();
    } catch {
        return '—';
    }
}

function getMethodLabel(method: string): string {
    const labels: Record<string, string> = {
        'primary': i18n.t('task_method_primary'),
        'accelerated': i18n.t('task_method_accelerated'),
        'fallback': i18n.t('task_method_fallback'),
        'test_mode': i18n.t('task_method_test'),
    };
    return labels[method] || method;
}

function getMethodColor(method: string): string {
    const colors: Record<string, string> = {
        'primary': '#34C759',
        'accelerated': '#FF9500',
        'fallback': '#FF6B6B',
        'test_mode': '#8B7DFF',
    };
    return colors[method] || '#999';
}
