import { lightImpact, notifyError, notifySuccess } from '@/components/ui/haptics';
import { useAccentBlue } from '@/constants/ios26-palette';
import i18n from '@/constants/language';
import { Fonts, TabularNums } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useMemo, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, ToastAndroid, useWindowDimensions, View } from 'react-native';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type StartupFailureSource = 'native_event' | 'startup_error_file' | 'fallback' | 'debug_switch';

export type StartupFailureInfo = {
    message: string;
    source: StartupFailureSource;
    occurredAt: string;
    type?: string;
    status?: number;
    statusName?: string;
    /** 消息被本地化替换时保留的原生 token，便于与原生日志对照。 */
    rawMessage?: string;
    /** 本次启动所用配置的指纹（长度 + djb2），不含配置内容。 */
    configFingerprint?: string;
    /** 失败时刻的最近日志快照（已格式化的行）。 */
    recentLogs?: string[];
};

type StartupFailureModalProps = {
    info: StartupFailureInfo | null;
    onClose: () => void;
};

export function StartupFailureModal({ info, onClose }: StartupFailureModalProps) {
    const theme = useTheme();
    const accent = useAccentBlue();
    const insets = useSafeAreaInsets();
    const { height, width } = useWindowDimensions();
    const [expanded, setExpanded] = useState(false);
    const [copyFeedback, setCopyFeedback] = useState('');

    const detailText = useMemo(() => info ? buildDetailText(info) : '', [info]);
    const maxCardHeight = Math.max(260, height - insets.top - insets.bottom - 48);
    const cardWidth = Math.min(340, width - 36);
    const isDark = theme.background === '#000000';
    const elevatedShadow = isDark
        ? '0 22px 48px rgba(0, 0, 0, 0.42)'
        : '0 22px 46px rgba(15, 23, 42, 0.18)';
    const detailSurface = isDark ? '#242426' : '#F6F7FB';
    const pressedSurface = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(60, 60, 67, 0.07)';
    const dangerSurface = isDark ? 'rgba(255, 69, 58, 0.18)' : 'rgba(255, 59, 48, 0.11)';
    const accentPressedSurface = isDark ? `${accent}24` : `${accent}12`;

    if (!info) return null;

    const copyDetails = async () => {
        lightImpact();
        try {
            await Clipboard.setStringAsync(detailText);
            notifySuccess();
            setCopyFeedback(i18n.t('startup_error_copied'));
            if (Platform.OS === 'android') ToastAndroid.show(i18n.t('startup_error_copied'), ToastAndroid.SHORT);
        } catch (e) {
            notifyError();
            setCopyFeedback(`${i18n.t('startup_error_copy_failed')}: ${String(e)}`);
        }
    };

    return (
        <Modal
            visible
            transparent
            animationType="fade"
            presentationStyle="overFullScreen"
            onRequestClose={onClose}
        >
            <View
                style={{
                    flex: 1,
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingHorizontal: 20,
                    paddingTop: Math.max(24, insets.top),
                    paddingBottom: Math.max(24, insets.bottom),
                    backgroundColor: 'rgba(0, 0, 0, 0.38)',
                }}
            >
                <Animated.View
                    entering={ZoomIn.duration(160)}
                    style={{
                        width: cardWidth,
                        maxHeight: maxCardHeight,
                        borderRadius: 24,
                        paddingHorizontal: 20,
                        paddingTop: 22,
                        paddingBottom: 10,
                        backgroundColor: theme.cardBackground,
                        boxShadow: elevatedShadow,
                    }}
                >
                    <View
                        style={{
                            alignItems: 'center',
                            gap: 10,
                        }}
                    >
                        <View
                            style={{
                                width: 46,
                                height: 46,
                                borderRadius: 23,
                                backgroundColor: dangerSurface,
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                        >
                            <Ionicons name="warning-outline" size={26} color="#FF453A" />
                        </View>
                        <Text
                            style={{
                                color: theme.text,
                                fontSize: 18,
                                lineHeight: 24,
                                fontWeight: '700',
                                textAlign: 'center',
                                fontFamily: Fonts?.rounded,
                            }}
                        >
                            {i18n.t('vpn_start_failed')}
                        </Text>
                        <Text
                            style={{
                                maxWidth: 292,
                                color: theme.textSecondary,
                                fontSize: 14,
                                lineHeight: 21,
                                textAlign: 'center',
                                fontFamily: Fonts?.sans,
                            }}
                        >
                            {i18n.t('startup_abnormal_exit')}
                        </Text>
                    </View>

                    <View style={{ height: 14 }} />

                    <Pressable
                        onPress={() => {
                            lightImpact();
                            setExpanded((value) => !value);
                            setCopyFeedback('');
                        }}
                        style={({ pressed }) => ({
                            minHeight: 48,
                            borderRadius: 12,
                            paddingHorizontal: 6,
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 8,
                            backgroundColor: pressed ? pressedSurface : 'transparent',
                        })}
                        accessibilityRole="button"
                    >
                        <Ionicons name="document-text-outline" size={17} color={theme.textSecondary} />
                        <Text
                            style={{
                                color: theme.textSecondary,
                                fontSize: 15,
                                fontWeight: '600',
                                fontFamily: Fonts?.sans,
                            }}
                        >
                            {expanded ? i18n.t('startup_hide_error_info') : i18n.t('startup_more_error_info')}
                        </Text>
                        <Ionicons
                            name={expanded ? 'chevron-up' : 'chevron-down'}
                            size={17}
                            color={theme.textSecondary}
                        />
                    </Pressable>

                    {expanded ? (
                        <Animated.View
                            entering={FadeInDown.duration(160)}
                            style={{
                                marginTop: 4,
                                borderRadius: 16,
                                padding: 10,
                                backgroundColor: detailSurface,
                                gap: 10,
                            }}
                        >
                            <View
                                style={{
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: 10,
                                }}
                            >
                                <Text
                                    style={{
                                        color: theme.textSecondary,
                                        fontSize: 12,
                                        fontWeight: '700',
                                        fontFamily: Fonts?.sans,
                                    }}
                                >
                                    {i18n.t('startup_error_info')}
                                </Text>
                                <Pressable
                                    onPress={copyDetails}
                                    hitSlop={8}
                                    style={({ pressed }) => ({
                                        minHeight: 32,
                                        flexDirection: 'row',
                                        alignItems: 'center',
                                        gap: 5,
                                        paddingHorizontal: 10,
                                        borderRadius: 9,
                                        backgroundColor: pressed ? accentPressedSurface : 'transparent',
                                    })}
                                    accessibilityRole="button"
                                    accessibilityLabel={i18n.t('startup_copy_error')}
                                >
                                    <Ionicons name="copy-outline" size={15} color={accent} />
                                    <Text
                                        style={{
                                            color: accent,
                                            fontSize: 12,
                                            fontWeight: '700',
                                            fontFamily: Fonts?.sans,
                                        }}
                                    >
                                        {i18n.t('startup_copy_error')}
                                    </Text>
                                </Pressable>
                            </View>

                            <Pressable
                                onPress={copyDetails}
                                style={({ pressed }) => ({
                                    borderRadius: 10,
                                    backgroundColor: pressed ? pressedSurface : 'transparent',
                                    overflow: 'hidden',
                                })}
                                accessibilityRole="button"
                                accessibilityLabel={i18n.t('startup_error_tap_to_copy')}
                            >
                                <ScrollView
                                    style={{ maxHeight: Math.min(164, maxCardHeight * 0.38) }}
                                    contentContainerStyle={{ padding: 11, gap: 8 }}
                                >
                                    <Text
                                        selectable
                                        style={{
                                            color: theme.text,
                                            fontSize: 11,
                                            lineHeight: 16,
                                            fontFamily: Fonts?.mono,
                                            fontVariant: TabularNums,
                                        }}
                                    >
                                        {detailText}
                                    </Text>
                                    <Text
                                        style={{
                                            color: copyFeedback ? accent : theme.textSecondary,
                                            fontSize: 11,
                                            fontWeight: '600',
                                            fontFamily: Fonts?.sans,
                                        }}
                                    >
                                        {copyFeedback || i18n.t('startup_error_tap_to_copy')}
                                    </Text>
                                </ScrollView>
                            </Pressable>
                        </Animated.View>
                    ) : null}

                    <View style={{ height: 8 }} />

                    <Pressable
                        onPress={() => {
                            lightImpact();
                            onClose();
                        }}
                        style={({ pressed }) => ({
                            minHeight: 48,
                            borderRadius: 14,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: pressed ? accentPressedSurface : 'transparent',
                        })}
                        accessibilityRole="button"
                    >
                        <Text
                            style={{
                                color: accent,
                                fontSize: 17,
                                fontWeight: '700',
                                fontFamily: Fonts?.rounded,
                            }}
                        >
                            {i18n.t('startup_acknowledge')}
                        </Text>
                    </Pressable>
                </Animated.View>
            </View>
        </Modal>
    );
}

function buildDetailText(info: StartupFailureInfo): string {
    const rows = [
        `${i18n.t('startup_error_time')}: ${formatOccurredAt(info.occurredAt)}`,
        `${i18n.t('startup_error_source')}: ${sourceLabel(info.source)}`,
    ];
    if (info.type) rows.push(`${i18n.t('startup_error_type')}: ${info.type}`);
    if (typeof info.status === 'number') rows.push(`${i18n.t('startup_error_status')}: ${info.status}`);
    if (info.statusName) rows.push(`${i18n.t('startup_error_status_name')}: ${info.statusName}`);
    if (info.rawMessage) rows.push(`${i18n.t('startup_error_raw_token')}: ${info.rawMessage}`);
    if (info.configFingerprint) rows.push(`${i18n.t('startup_error_config_fingerprint')}: ${info.configFingerprint}`);
    rows.push('', `${i18n.t('startup_error_message')}:`, info.message || i18n.t('startup_error_empty_message'));
    if (info.recentLogs?.length) {
        rows.push('', `${i18n.t('startup_error_recent_logs')}:`, ...info.recentLogs);
    }
    return rows.join('\n');
}

function sourceLabel(source: StartupFailureSource): string {
    if (source === 'native_event') return i18n.t('startup_error_source_native_event');
    if (source === 'startup_error_file') return i18n.t('startup_error_source_startup_file');
    if (source === 'debug_switch') return i18n.t('startup_error_source_debug_switch');
    return i18n.t('startup_error_source_fallback');
}

function formatOccurredAt(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return `${date.toLocaleString()} (${value})`;
}
