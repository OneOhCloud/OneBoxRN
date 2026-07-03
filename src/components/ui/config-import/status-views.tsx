/**
 * 配置导入屏 — 各状态的展示视图。放在 src/app/ 之外，因为 src/app/ 下的文件是路由，
 * 这些不是。按 ImportPhase 家族每种一个视图：loading / error / success / default。
 */
import { mediumImpact } from '@/components/ui/haptics';
import i18n from '@/constants/language';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatBytes } from '@/utils/format-bytes';
import type { ProfileTrafficInfo } from '@/utils/profile-info';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

// ─── 共享：Icon Orb ─────────────────────────────────────────
function IconOrb({
    name,
    color,
    tint,
}: {
    name: keyof typeof Ionicons.glyphMap;
    color: string;
    tint: string;
}) {
    return (
        <View
            style={{
                width: 76,
                height: 76,
                borderRadius: 38,
                backgroundColor: tint,
                alignItems: 'center',
                justifyContent: 'center',
            }}
        >
            <Ionicons name={name} size={36} color={color} />
        </View>
    );
}

// ─── Loading 状态 ───────────────────────────────────────────
export function LoadingView() {
    const theme = useTheme();
    return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}>
            <IconOrb name="cloud-download-outline" color="#007AFF" tint="#007AFF18" />
            <Text style={{ fontSize: 17, fontWeight: '600', fontFamily: Fonts?.rounded, color: theme.text, marginTop: 20, letterSpacing: -0.4, lineHeight: 24 }}>
                {i18n.t('config_downloading')}
            </Text>
            <Text style={{ fontSize: 15, color: theme.textSecondary, marginTop: 6 }}>
                {i18n.t('config_please_wait')}
            </Text>
            <ActivityIndicator size="large" color="#007AFF" style={{ marginTop: 32 }} />
        </View>
    );
}

// ─── Error 状态 ─────────────────────────────────────────────
export function ErrorView({ message }: { message: string }) {
    const theme = useTheme();
    return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, backgroundColor: theme.background }}>
            <IconOrb name="alert-circle" color="#FF3B30" tint="#FF3B3015" />
            <Text style={{ fontSize: 17, fontWeight: '600', fontFamily: Fonts?.rounded, color: theme.text, marginTop: 20, letterSpacing: -0.4, lineHeight: 24 }}>
                {i18n.t('config_download_failed_title')}
            </Text>
            <Text style={{ fontSize: 15, color: theme.textSecondary, marginTop: 6, textAlign: 'center' }}>
                {i18n.t('config_download_failed_hint')}
            </Text>
            <View
                style={{
                    width: '100%',
                    maxWidth: 360,
                    marginTop: 20,
                    borderRadius: 14,
                    backgroundColor: theme.cardBackground,
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                }}
            >
                <ScrollView style={{ maxHeight: 110 }} showsVerticalScrollIndicator={false}>
                    <Text style={{ fontSize: 13, color: '#FF3B30', lineHeight: 19, fontFamily: Fonts?.mono }}>
                        {message}
                    </Text>
                </ScrollView>
            </View>
            <Pressable
                onPress={() => { mediumImpact(); router.back(); }}
                style={({ pressed }) => ({
                    marginTop: 24,
                    minWidth: 120,
                    alignItems: 'center',
                    paddingHorizontal: 32,
                    paddingVertical: 13,
                    borderRadius: 100,
                    backgroundColor: theme.backgroundElement,
                    opacity: pressed ? 0.55 : 1,
                })}
                hitSlop={8}
            >
                <Text style={{ fontSize: 15, fontWeight: '500', color: theme.text }}>{i18n.t('back')}</Text>
            </Pressable>
        </View>
    );
}

// ─── Success 状态 ───────────────────────────────────────────
function InfoRow({
    label,
    value,
    isLast,
}: {
    label: string;
    value: string;
    isLast?: boolean;
}) {
    const theme = useTheme();
    return (
        <View
            style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingVertical: 13,
                borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
                borderBottomColor: theme.border,
            }}
        >
            <Text style={{ fontSize: 15, color: theme.textSecondary }}>{label}</Text>
            <Text style={{ fontSize: 15, fontWeight: '500', color: theme.text }}>{value}</Text>
        </View>
    );
}

export function SuccessView({
    extraInfo,
}: {
    extraInfo: ProfileTrafficInfo | null;
}) {
    const theme = useTheme();
    const used = extraInfo ? extraInfo.upload + extraInfo.download : 0;
    const total = extraInfo ? extraInfo.total : 0;
    const expireDate = extraInfo && extraInfo.expire > 0 ? new Date(extraInfo.expire * 1000) : null;
    const left = total > used ? total - used : 0;
    const usedPercent = total > 0 ? Math.min((used / total) * 100, 100) : 0;
    const isNearLimit = usedPercent > 85;

    return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, backgroundColor: theme.background }}>
            <IconOrb name="checkmark-circle" color="#34C759" tint="#34C75915" />
            <Text style={{ fontSize: 17, fontWeight: '600', fontFamily: Fonts?.rounded, color: theme.text, marginTop: 20, letterSpacing: -0.4, lineHeight: 24 }}>
                {i18n.t('config_import_success_title')}
            </Text>
            <Text style={{ fontSize: 15, color: theme.textSecondary, marginTop: 6 }}>
                {i18n.t('config_import_success_hint')}
            </Text>

            {/* 信息卡片 */}
            <View
                style={{
                    width: '100%',
                    maxWidth: 360,
                    marginTop: 28,
                    borderRadius: 16,
                    backgroundColor: theme.cardBackground,
                    paddingHorizontal: 16,
                    overflow: 'hidden',
                }}
            >
                {/* 流量区块 */}
                {total > 0 && (
                    <View style={{ paddingTop: 14, paddingBottom: 4 }}>
                        {/* 标签行 */}
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                            <Text style={{ fontSize: 13, fontWeight: '500', color: theme.textSecondary }}>
                                {i18n.t('config_traffic_label')}
                            </Text>
                            <Text style={{ fontSize: 13, fontWeight: '600', color: isNearLimit ? '#FF3B30' : theme.text }}>
                                {i18n.t('config_traffic_remaining', { amount: formatBytes(left) })}
                            </Text>
                        </View>
                        {/* 进度条轨道 */}
                        <View style={{ width: '100%', height: 6, borderRadius: 3, backgroundColor: theme.backgroundElement }}>
                            <View
                                style={{
                                    height: 6,
                                    borderRadius: 3,
                                    width: `${usedPercent}%`,
                                    backgroundColor: isNearLimit ? '#FF3B30' : '#007AFF',
                                }}
                            />
                        </View>
                        {/* 副标签 */}
                        <View
                            style={{
                                flexDirection: 'row',
                                justifyContent: 'space-between',
                                marginTop: 8,
                                paddingBottom: 13,
                                borderBottomWidth: StyleSheet.hairlineWidth,
                                borderBottomColor: theme.border,
                            }}
                        >
                            <Text style={{ fontSize: 12, color: theme.textSecondary }}>
                                {i18n.t('config_traffic_used_label', { amount: formatBytes(used), percent: usedPercent.toFixed(1) })}
                            </Text>
                            <Text style={{ fontSize: 12, color: theme.textSecondary }}>
                                {i18n.t('config_traffic_total_label', { amount: formatBytes(total) })}
                            </Text>
                        </View>
                    </View>
                )}

                {/* 到期行 */}
                <InfoRow
                    label={i18n.t('expire_time')}
                    value={expireDate ? expireDate.toLocaleDateString() : i18n.t('config_no_expire')}
                    isLast
                />
            </View>

            {/* 主行动按钮 */}
            <Pressable
                onPress={() => { mediumImpact(); router.dismissTo('/'); }}
                style={({ pressed }) => ({
                    marginTop: 32,
                    width: '100%',
                    maxWidth: 360,
                    alignItems: 'center',
                    paddingVertical: 16,
                    borderRadius: 14,
                    backgroundColor: '#007AFF',
                    opacity: pressed ? 0.72 : 1,
                })}
            >
                <Text style={{ color: '#ffffff', fontSize: 17, fontWeight: '600', letterSpacing: -0.3, fontFamily: Fonts?.rounded, lineHeight: 24 }}>
                    {i18n.t('config_get_started')}
                </Text>
            </Pressable>
        </View>
    );
}

// ─── Default / 无 URL 状态 ──────────────────────────────────
export function DefaultView() {
    const theme = useTheme();
    return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}>
            <IconOrb name="link-outline" color={theme.textSecondary} tint={theme.backgroundElement} />
            <Text style={{ fontSize: 15, color: theme.textSecondary, marginTop: 16, textAlign: 'center' }}>
                {i18n.t('config_deep_link_hint')}
            </Text>
        </View>
    );
}
