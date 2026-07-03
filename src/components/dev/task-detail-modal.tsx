import { lightImpact } from '@/components/ui/haptics';
import { useAccentBlue, useHairlineColor } from '@/constants/ios26-palette';
import i18n from '@/constants/language';
import { Fonts, Spacing, TabularNums } from '@/constants/theme';
import type { TaskRecord } from '@/database/kv';
import { useTheme } from '@/hooks/use-theme';
import { formatDuration } from '@/utils/dev-utils';
import { formatBytes } from '@/utils/format-bytes';
import * as Clipboard from 'expo-clipboard';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

interface TaskDetailModalProps {
    record: TaskRecord | null;
    visible: boolean;
    onClose: () => void;
}

export function TaskDetailModal({ record, visible, onClose }: TaskDetailModalProps) {
    const theme = useTheme();
    const hairline = useHairlineColor();
    const accent = useAccentBlue();

    if (!record) return null;

    const statusColor = record.status === 'success' ? '#34C759' : record.status === 'failed' ? '#FF3B30' : '#FF9500';

    const copyToClipboard = async (text: string, label: string) => {
        lightImpact();
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
                <Animated.View
                    entering={FadeIn.duration(220)}
                    style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        paddingHorizontal: Spacing.three,
                        height: 52,
                        borderBottomWidth: StyleSheet.hairlineWidth,
                        borderBottomColor: hairline,
                    }}
                >
                    <View style={{ width: 48 }} />
                    <Text
                        style={{
                            fontSize: 17,
                            fontWeight: '700',
                            color: theme.text,
                            fontFamily: Fonts?.rounded,
                            letterSpacing: -0.4,
                        }}
                    >
                        {i18n.t('task_detail_title')}
                    </Text>
                    <Pressable
                        onPress={() => { lightImpact(); onClose(); }}
                        hitSlop={10}
                        style={({ pressed }) => ({
                            width: 48,
                            alignItems: 'flex-end',
                            opacity: pressed ? 0.55 : 1,
                        })}
                    >
                        <Text
                            style={{
                                fontSize: 17,
                                color: accent,
                                fontFamily: Fonts?.rounded,
                                fontWeight: '600',
                                letterSpacing: -0.3,
                            }}
                        >
                            Done
                        </Text>
                    </Pressable>
                </Animated.View>

                {/* Content */}
                <ScrollView
                    style={{ flex: 1 }}
                    contentContainerStyle={{
                        paddingHorizontal: Spacing.three,
                        paddingTop: Spacing.three,
                        paddingBottom: Spacing.five,
                    }}
                    showsVerticalScrollIndicator={false}
                >
                    {/* Status banner */}
                    <Animated.View
                        entering={FadeInDown.duration(320).delay(60)}
                        style={{
                            backgroundColor: theme.glassBackground,
                            borderRadius: 20,
                            borderWidth: StyleSheet.hairlineWidth,
                            borderColor: theme.glassBorder,
                            paddingHorizontal: 20,
                            paddingVertical: 18,
                            marginBottom: Spacing.four,
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 16,
                        }}
                    >
                        <View
                            style={{
                                width: 44,
                                height: 44,
                                borderRadius: 22,
                                backgroundColor: statusColor,
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                        >
                            <Text style={{ fontSize: 22, color: '#fff', fontWeight: '700' }}>
                                {record.status === 'success' ? '✓' : record.status === 'failed' ? '✕' : '—'}
                            </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text
                                style={{
                                    fontSize: 11,
                                    color: theme.textSecondary,
                                    fontFamily: Fonts?.sans,
                                    fontWeight: '600',
                                    textTransform: 'uppercase',
                                    letterSpacing: 0.4,
                                    marginBottom: 2,
                                }}
                            >
                                {record.status}
                            </Text>
                            <Text
                                style={{
                                    fontSize: 20,
                                    color: theme.text,
                                    fontFamily: Fonts?.rounded,
                                    fontWeight: '700',
                                    letterSpacing: -0.4,
                                }}
                            >
                                {formatTime(record.time)}
                            </Text>
                            <Text
                                style={{
                                    fontSize: 13,
                                    color: theme.textSecondary,
                                    fontFamily: Fonts?.mono,
                                    fontVariant: TabularNums,
                                    marginTop: 2,
                                }}
                            >
                                {formatDuration(record.duration)} · {getMethodLabel(record.method)}
                            </Text>
                        </View>
                    </Animated.View>

                    {/* Timing & Flags */}
                    <DetailSection index={1}>
                        <DetailRow label={i18n.t('task_config_updated')} value={record.contentChanged ? i18n.t('task_yes') : i18n.t('task_no')} isLast={!record.flowId} />
                        {record.flowId && (
                            <DetailRow label="Flow ID" value={record.flowId} isLast />
                        )}
                    </DetailSection>

                    {/* Accelerated URL (redacted form only — raw URLs never persist) */}
                    {record.acceleratedUrlRedacted && (
                        <DetailSection title={i18n.t('task_request_urls')} index={2}>
                            <URLRow
                                label={i18n.t('task_accelerated_url')}
                                url={record.acceleratedUrlRedacted}
                                onCopy={() => copyToClipboard(record.acceleratedUrlRedacted!, i18n.t('task_accelerated_url'))}
                                isLast
                                color="#FF9500"
                            />
                        </DetailSection>
                    )}

                    {/* Profile Info — parsed traffic (raw header never persists) */}
                    {record.status === 'success' && record.total > 0 && (
                        <DetailSection title={i18n.t('task_config_info')} index={3}>
                            <DetailRow label={i18n.t('task_upload')} value={formatBytes(record.upload)} />
                            <DetailRow label={i18n.t('task_download')} value={formatBytes(record.download)} />
                            <DetailRow label={i18n.t('task_total')} value={formatBytes(record.total)} />
                            <DetailRow label={i18n.t('task_expire')} value={formatExpire(record.expire)} isLast />
                        </DetailSection>
                    )}

                    {/* Error Info */}
                    {record.error && record.status === 'failed' && (
                        <DetailSection title={i18n.t('task_error_info')} index={4}>
                            <Pressable
                                onPress={() => copyToClipboard(record.error!, i18n.t('task_error_info'))}
                                style={({ pressed }) => ({
                                    paddingHorizontal: 16,
                                    paddingVertical: 12,
                                    opacity: pressed ? 0.55 : 1,
                                })}
                            >
                                <View style={{
                                    backgroundColor: theme.backgroundElement,
                                    padding: 10,
                                    borderRadius: 10,
                                    borderLeftWidth: 3,
                                    borderLeftColor: '#FF3B30',
                                }}>
                                    <Text style={{
                                        fontSize: 11,
                                        color: theme.text,
                                        fontFamily: Fonts?.mono,
                                        lineHeight: 16,
                                    }}>
                                        {record.error}
                                    </Text>
                                </View>
                                <Text style={{
                                    fontSize: 10,
                                    color: theme.textSecondary,
                                    fontFamily: Fonts?.sans,
                                    marginTop: 6,
                                    letterSpacing: 0.4,
                                    textTransform: 'uppercase',
                                }}>
                                    {i18n.t('task_tap_to_copy')}
                                </Text>
                            </Pressable>
                        </DetailSection>
                    )}
                </ScrollView>
            </SafeAreaView>
        </Modal>
    );
}

// ─── Helper Components ───────────────────────────────────────────────────────

function DetailSection({ title, children, index = 0 }: { title?: string; children: React.ReactNode; index?: number }) {
    const theme = useTheme();
    return (
        <Animated.View
            entering={FadeInDown.duration(320).delay(60 + index * 50)}
            style={{ marginBottom: Spacing.four }}
        >
            {title ? (
                <Text style={{
                    fontSize: 13,
                    fontFamily: Fonts?.sans,
                    fontWeight: '500',
                    color: theme.textSecondary,
                    letterSpacing: -0.08,
                    textTransform: 'uppercase',
                    marginHorizontal: 20,
                    marginBottom: 8,
                }}>
                    {title}
                </Text>
            ) : null}
            <View style={{
                backgroundColor: theme.glassBackground,
                borderRadius: 20,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.glassBorder,
                overflow: 'hidden',
            }}>
                {children}
            </View>
        </Animated.View>
    );
}

function DetailRow({ label, value, valueColor, isLast }: {
    label: string;
    value: string;
    valueColor?: string;
    isLast?: boolean;
}) {
    const theme = useTheme();
    const hairline = useHairlineColor();
    return (
        <View>
            <View
                style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingHorizontal: 16,
                    paddingVertical: 13,
                }}
            >
                <Text
                    style={{
                        fontSize: 15,
                        color: theme.text,
                        fontFamily: Fonts?.rounded,
                        fontWeight: '500',
                        letterSpacing: -0.2,
                    }}
                >
                    {label}
                </Text>
                <Text
                    style={{
                        fontSize: 14,
                        color: valueColor || theme.textSecondary,
                        fontWeight: '500',
                        fontFamily: Fonts?.mono,
                        fontVariant: TabularNums,
                        maxWidth: 220,
                    }}
                    numberOfLines={1}
                >
                    {value}
                </Text>
            </View>
            {!isLast && (
                <View
                    style={{
                        height: StyleSheet.hairlineWidth,
                        marginLeft: 16,
                        backgroundColor: hairline,
                    }}
                />
            )}
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
    const hairline = useHairlineColor();
    return (
        <Pressable
            onPress={onCopy}
            style={({ pressed }) => ({
                paddingHorizontal: 16,
                paddingVertical: 12,
                borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
                borderBottomColor: hairline,
                opacity: pressed ? 0.55 : 1,
            })}
        >
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 6 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
                <Text
                    style={{
                        fontSize: 11,
                        color: theme.textSecondary,
                        fontFamily: Fonts?.sans,
                        fontWeight: '600',
                        textTransform: 'uppercase',
                        letterSpacing: 0.4,
                    }}
                >
                    {label} · {i18n.t('task_tap_to_copy')}
                </Text>
            </View>
            <Text
                style={{ fontSize: 12, color: theme.text, fontFamily: Fonts?.mono, lineHeight: 16 }}
                numberOfLines={3}
            >
                {url}
            </Text>
        </Pressable>
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
