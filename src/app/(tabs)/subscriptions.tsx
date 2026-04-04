/**
 * Subscriptions Screen — routing mode selector + multi-subscription management.
 */
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { mediumImpact, notifyError, notifySuccess } from '@/components/ui/haptics';
import CameraQR from '@/components/ui/camera-qr';
import { ImportUrlModal } from '@/components/ui/home/import-url-modal';
import { ModeSelector } from '@/components/ui/home/mode-selector';
import { fmtBytes } from '@/components/ui/home/subscription-info-card';
import { SectionLabel } from '@/components/ui/home/traffic-card';
import i18n from '@/constants/language';
import { BottomTabInset, Fonts, MaxContentWidth, Spacing } from '@/constants/theme';
import { Subscription, SubscriptionStore } from '@/database/kv';
import { useTheme } from '@/hooks/use-theme';
import { executeConfigRefresh } from '@/tasks/config-refresh';
import { urlHostname } from '@/utils';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// ─── Shared card shell ────────────────────────────────────────────────────────

function Card({ children, style }: { children: React.ReactNode; style?: object }) {
    const theme = useTheme();
    return (
        <View style={[{ backgroundColor: theme.cardBackground, borderRadius: 14, paddingHorizontal: 16, overflow: 'hidden' }, style]}>
            {children}
        </View>
    );
}

// ─── Card row ─────────────────────────────────────────────────────────────────

function CardRow({
    icon,
    iconColor,
    label,
    value,
    onPress,
    isLast,
}: {
    icon: React.ComponentProps<typeof Ionicons>['name'];
    iconColor: string;
    label: string;
    value?: string;
    onPress?: () => void;
    isLast?: boolean;
}) {
    const theme = useTheme();
    return (
        <Pressable
            onPress={() => { if (onPress) { mediumImpact(); onPress(); } }}
            style={({ pressed }) => ({
                opacity: pressed && onPress ? 0.55 : 1,
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 12,
                gap: 12,
                borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
                borderBottomColor: theme.border,
            })}
        >
            <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: iconColor, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name={icon} size={16} color="#fff" />
            </View>
            <Text style={{ flex: 1, fontSize: 15, color: theme.text, fontFamily: Fonts?.sans }}>{label}</Text>
            {value !== undefined && (
                <Text numberOfLines={1} style={{ fontSize: 13, color: theme.textSecondary, maxWidth: 180 }}>{value}</Text>
            )}
            {onPress && <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />}
        </Pressable>
    );
}

// ─── Traffic bar ──────────────────────────────────────────────────────────────

function TrafficBar({ used, total }: { used: number; total: number }) {
    const theme = useTheme();
    const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
    const nearLimit = pct > 85;
    const remaining = Math.max(0, total - used);

    return (
        <View style={{ paddingVertical: 12 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                <Text style={{ fontSize: 13, color: theme.textSecondary }}>
                    {i18n.t('sub_traffic_used', { used: fmtBytes(used), total: fmtBytes(total) })}
                </Text>
                <Text style={{ fontSize: 13, color: nearLimit ? '#FF3B30' : theme.textSecondary }}>
                    {i18n.t('config_traffic_remaining', { amount: fmtBytes(remaining) })}
                </Text>
            </View>
            <View style={{ height: 5, borderRadius: 3, backgroundColor: theme.backgroundElement }}>
                <View style={{ height: 5, borderRadius: 3, width: `${pct}%`, backgroundColor: nearLimit ? '#FF3B30' : '#007AFF' }} />
            </View>
        </View>
    );
}

// ─── Subscription list row ────────────────────────────────────────────────────

function SubscriptionRow({
    sub,
    isActive,
    isLast,
    onActivate,
    onDelete,
}: {
    sub: Subscription;
    isActive: boolean;
    isLast: boolean;
    onActivate: () => void;
    onDelete: () => void;
}) {
    const theme = useTheme();
    const hostname = urlHostname(sub.url, sub.url);

    return (
        <Pressable
            onPress={() => { mediumImpact(); onActivate(); }}
            style={({ pressed }) => ({
                opacity: pressed ? 0.6 : 1,
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 13,
                gap: 12,
                borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
                borderBottomColor: theme.border,
            })}
        >
            <View style={{
                width: 22, height: 22, borderRadius: 11,
                borderWidth: isActive ? 0 : 1.5,
                borderColor: theme.border,
                backgroundColor: isActive ? '#007AFF' : 'transparent',
                alignItems: 'center', justifyContent: 'center',
            }}>
                {isActive && <Ionicons name="checkmark" size={13} color="#fff" />}
            </View>

            <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontSize: 15, color: theme.text, fontFamily: Fonts?.sans }}>
                    {sub.name}
                </Text>
                <Text numberOfLines={1} style={{ fontSize: 13, color: theme.textSecondary, marginTop: 2 }}>
                    {hostname}
                </Text>
            </View>

            <Pressable
                onPress={() => { mediumImpact(); onDelete(); }}
                hitSlop={8}
                style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1, padding: 4 })}
            >
                <Ionicons name="trash-outline" size={18} color="#FF3B30" />
            </Pressable>
        </Pressable>
    );
}

// ─── Active subscription detail ───────────────────────────────────────────────

function ActiveSubDetail({
    sub,
    refreshing,
    onRefresh,
    onScanQR,
    onImportUrl,
}: {
    sub: Subscription;
    refreshing: boolean;
    onRefresh: () => void;
    onScanQR: () => void;
    onImportUrl: () => void;
}) {
    const theme = useTheme();
    const expireDate = sub.expireTime > 0
        ? new Date(sub.expireTime * 1000).toLocaleDateString(
            i18n.locale.startsWith('zh') ? 'zh-CN' : 'en-US',
            { year: 'numeric', month: '2-digit', day: '2-digit' }
        )
        : i18n.t('config_no_expire');

    return (
        <View style={{ gap: 20 }}>
            {/* Info */}
            <View>
                <SectionLabel text={i18n.t('sub_section_info')} />
                <Card>
                    <CardRow icon="person-circle-outline" iconColor="#5856D6" label={i18n.t('sub_name')} value={sub.name} />
                    <CardRow icon="link-outline" iconColor="#007AFF" label={i18n.t('sub_url')} value={urlHostname(sub.url, sub.url)} isLast={sub.totalTraffic <= 1 && sub.expireTime <= 0} />
                    {sub.totalTraffic > 1 && (
                        <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }}>
                            <TrafficBar used={sub.usedTraffic} total={sub.totalTraffic} />
                        </View>
                    )}
                    {sub.expireTime > 0 && (
                        <CardRow icon="calendar-outline" iconColor="#34C759" label={i18n.t('sub_expire')} value={expireDate} isLast />
                    )}
                </Card>
            </View>

            {/* Actions */}
            <View>
                <SectionLabel text={i18n.t('sub_section_actions')} />
                <Card>
                    <CardRow
                        icon="refresh-outline" iconColor="#007AFF"
                        label={refreshing ? i18n.t('sub_refreshing') : i18n.t('sub_refresh')}
                        onPress={refreshing ? undefined : onRefresh}
                    />
                    <CardRow icon="qr-code-outline" iconColor="#FF9500" label={i18n.t('scan_qr')} onPress={onScanQR} />
                    <CardRow icon="link-outline" iconColor="#FF9500" label={i18n.t('import_url')} onPress={onImportUrl} isLast />
                </Card>
            </View>
        </View>
    );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ onScanQR, onImportUrl }: { onScanQR: () => void; onImportUrl: () => void }) {
    const theme = useTheme();
    return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: theme.backgroundElement, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <Ionicons name="cloud-download-outline" size={28} color={theme.textSecondary} />
            </View>
            <ThemedText style={{ fontSize: 17, fontWeight: '600', fontFamily: Fonts?.rounded, letterSpacing: -0.4, lineHeight: 24, marginBottom: 6 }}>
                {i18n.t('sub_empty_title')}
            </ThemedText>
            <ThemedText themeColor="textSecondary" style={{ fontSize: 14, textAlign: 'center', marginBottom: 28 }}>
                {i18n.t('sub_empty_desc')}
            </ThemedText>
            <View style={{ flexDirection: 'row', gap: 12 }}>
                <Pressable
                    onPress={() => { mediumImpact(); onScanQR(); }}
                    style={({ pressed }) => ({ flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 12, backgroundColor: theme.backgroundElement, opacity: pressed ? 0.55 : 1 })}
                >
                    <Ionicons name="qr-code-outline" size={20} color={theme.text} style={{ marginBottom: 5 }} />
                    <ThemedText style={{ fontSize: 13, fontWeight: '500' }}>{i18n.t('scan_qr')}</ThemedText>
                </Pressable>
                <Pressable
                    onPress={() => { mediumImpact(); onImportUrl(); }}
                    style={({ pressed }) => ({ flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 12, backgroundColor: '#007AFF', opacity: pressed ? 0.72 : 1 })}
                >
                    <Ionicons name="link-outline" size={20} color="#fff" style={{ marginBottom: 5 }} />
                    <Text style={{ fontSize: 13, fontWeight: '500', color: '#fff' }}>{i18n.t('import_url')}</Text>
                </Pressable>
            </View>
        </View>
    );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SubscriptionsScreen() {
    const theme = useTheme();

    const [subs, setSubs] = useState<Subscription[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [cameraVisible, setCameraVisible] = useState(false);
    const [importUrlVisible, setImportUrlVisible] = useState(false);

    const loadData = useCallback(() => {
        setSubs(SubscriptionStore.getAll());
        setActiveId(SubscriptionStore.getActiveId());
    }, []);

    useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

    const handleActivate = useCallback((id: string) => {
        SubscriptionStore.setActiveId(id);
        setActiveId(id);
    }, []);

    const handleDelete = useCallback((sub: Subscription) => {
        Alert.alert(i18n.t('sub_delete'), i18n.t('sub_delete_confirm'), [
            { text: i18n.t('cancel'), style: 'cancel' },
            { text: i18n.t('sub_delete'), style: 'destructive', onPress: () => { SubscriptionStore.delete(sub.id); loadData(); } },
        ]);
    }, [loadData]);

    const handleRefresh = useCallback(async () => {
        if (refreshing) return;
        setRefreshing(true);
        try {
            const result = await executeConfigRefresh();
            if (result?.status === 'success') {
                notifySuccess();
                loadData();
            } else {
                notifyError();
                Alert.alert(i18n.t('sub_refresh_failed'), result?.error ?? '');
            }
        } catch (e: unknown) {
            notifyError();
            Alert.alert(i18n.t('sub_refresh_failed'), e instanceof Error ? e.message : '');
        } finally {
            setRefreshing(false);
        }
    }, [refreshing, loadData]);

    const handleImportClose = useCallback(() => { setImportUrlVisible(false); loadData(); }, [loadData]);
    const handleCameraClose = useCallback(() => { setCameraVisible(false); loadData(); }, [loadData]);

    const activeSub = subs.find(s => s.id === activeId) ?? null;

    return (
        <ThemedView style={{ flex: 1 }}>
            <SafeAreaView style={{ flex: 1, flexDirection: 'row', justifyContent: 'center' }}>
                <View style={{ flex: 1, maxWidth: MaxContentWidth }}>

                    {/* Title bar */}
                    <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4, flexDirection: 'row', alignItems: 'center' }}>
                        <ThemedText style={{ flex: 1, fontSize: 28, fontWeight: '700', fontFamily: Fonts?.rounded, letterSpacing: -0.5, lineHeight: 36 }}>
                            {i18n.t('sub_title')}
                        </ThemedText>
                        <Pressable
                            onPress={() => { mediumImpact(); setImportUrlVisible(true); }}
                            style={({ pressed }) => ({
                                width: 36, height: 36, borderRadius: 18,
                                backgroundColor: theme.backgroundElement,
                                alignItems: 'center', justifyContent: 'center',
                                opacity: pressed ? 0.55 : 1,
                            })}
                            hitSlop={8}
                        >
                            <Ionicons name="add" size={22} color={theme.text} />
                        </Pressable>
                    </View>

                    {/* Scrollable content — routing mode always at top */}
                    <ScrollView
                        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingTop: 12, paddingBottom: BottomTabInset + Spacing.three, gap: 20 }}
                        showsVerticalScrollIndicator={false}
                    >
                        {/* Routing mode */}
                        <View>
                            <SectionLabel text={i18n.t('section_routing_mode')} />
                            <ModeSelector hideSectionLabel />
                        </View>

                        {/* Subscriptions */}
                        {subs.length === 0 ? (
                            <EmptyState
                                onScanQR={() => setCameraVisible(true)}
                                onImportUrl={() => setImportUrlVisible(true)}
                            />
                        ) : (
                            <View style={{ gap: 20 }}>
                                <View>
                                    <SectionLabel text={i18n.t('sub_section_list')} />
                                    <Card>
                                        {subs.map((sub, idx) => (
                                            <SubscriptionRow
                                                key={sub.id}
                                                sub={sub}
                                                isActive={sub.id === activeId}
                                                isLast={idx === subs.length - 1}
                                                onActivate={() => handleActivate(sub.id)}
                                                onDelete={() => handleDelete(sub)}
                                            />
                                        ))}
                                    </Card>
                                </View>

                                {activeSub && (
                                    <ActiveSubDetail
                                        sub={activeSub}
                                        refreshing={refreshing}
                                        onRefresh={handleRefresh}
                                        onScanQR={() => setCameraVisible(true)}
                                        onImportUrl={() => setImportUrlVisible(true)}
                                    />
                                )}
                            </View>
                        )}
                    </ScrollView>
                </View>
            </SafeAreaView>

            <ImportUrlModal visible={importUrlVisible} onClose={handleImportClose} />
            <Modal visible={cameraVisible} onRequestClose={handleCameraClose}>
                <View style={{ flex: 1, backgroundColor: '#000' }}>
                    <CameraQR onHandleClose={handleCameraClose} />
                </View>
            </Modal>
        </ThemedView>
    );
}
