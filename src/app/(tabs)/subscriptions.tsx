/**
 * Profiles Screen — routing mode selector + multi-profile management.
 * Redesigned with unified active profile card + simplified profile list.
 */
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { mediumImpact, notifyError, notifySuccess } from '@/components/ui/haptics';
import { EmptyState } from '@/components/ui/home/empty-state';
import { ImportUrlModal } from '@/components/ui/home/import-url-modal';
import { ModeSelector } from '@/components/ui/home/mode-selector';
import { fmtBytes } from '@/components/ui/home/subscription-info-card';
import i18n from '@/constants/language';
import { BottomTabInset, Fonts, MaxContentWidth, Spacing } from '@/constants/theme';
import { useVpn } from '@/contexts/vpn-context';
import { Subscription, SubscriptionStore } from '@/database/kv';
import { useTheme } from '@/hooks/use-theme';
import { executeConfigRefresh } from '@/tasks/config-refresh';
import { urlHostname } from '@/utils';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Circle, Svg } from 'react-native-svg';

// ─── Shared card shell ────────────────────────────────────────────────────────

function Card({ children, style }: { children: React.ReactNode; style?: object }) {
    const theme = useTheme();
    return (
        <View style={[{ backgroundColor: theme.cardBackground, borderRadius: 20, paddingHorizontal: 16, overflow: 'hidden' }, style]}>
            {children}
        </View>
    );
}

// ─── Circular progress or icon placeholder ─────────────────────────────────

function TrafficIndicator({ percentage, color, hasData, textSecondaryColor }: { percentage: number; color: string; hasData: boolean; textSecondaryColor: string }) {
    const size = 160;

    if (hasData) {
        const strokeWidth = 5;
        const radius = (size - strokeWidth) / 2;
        const circumference = 2 * Math.PI * radius;
        const offset = circumference - (percentage / 100) * circumference;

        return (
            <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                    {/* Background circle */}
                    <Circle
                        cx={size / 2}
                        cy={size / 2}
                        r={radius}
                        stroke="#E5E5EA"
                        strokeWidth={strokeWidth}
                        fill="none"
                    />
                    {/* Progress circle */}
                    <Circle
                        cx={size / 2}
                        cy={size / 2}
                        r={radius}
                        stroke={color}
                        strokeWidth={strokeWidth}
                        fill="none"
                        strokeDasharray={circumference}
                        strokeDashoffset={offset}
                        strokeLinecap="round"
                        rotation="-90"
                        origin={`${size / 2}, ${size / 2}`}
                    />
                </Svg>
                {/* Percentage text */}
                <Text style={{ position: 'absolute', fontSize: 28, fontWeight: '600', color }}>
                    {Math.round(percentage)}%
                </Text>
            </View>
        );
    }

    // No data: show icon instead
    return (
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Ionicons name="cloud-circle" size={128} color={textSecondaryColor} />
        </View>
    );
}

// ─── Traffic bar — labels above values, wrapped around indicator ──────────────

function TrafficBar({ used, total }: { used: number; total: number }) {
    const theme = useTheme();
    const hasData = total > 0;
    const pct = hasData ? Math.min((used / total) * 100, 100) : 0;
    const nearLimit = pct > 85;
    const remaining = Math.max(0, total - used);
    const color = nearLimit ? '#FF3B30' : '#007AFF';

    return (
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
            <View style={{ flex: 1, gap: 12, paddingTop: 4 }}>
                <View>
                    <Text style={{ fontSize: 11, color: theme.textSecondary, marginBottom: 2 }}>
                        {i18n.t('traffic_used')}
                    </Text>
                    <Text style={{ fontSize: 16, color: theme.text, fontWeight: '600' }}>
                        {hasData ? fmtBytes(used) : '-'}
                    </Text>
                </View>
                <View>
                    <Text style={{ fontSize: 11, color: theme.textSecondary, marginBottom: 2 }}>
                        {i18n.t('traffic_remaining')}
                    </Text>
                    <Text style={{ fontSize: 16, color: nearLimit ? '#FF3B30' : theme.text, fontWeight: '600' }}>
                        {hasData ? fmtBytes(remaining) : '-'}
                    </Text>
                </View>
                <View>
                    <Text style={{ fontSize: 11, color: theme.textSecondary, marginBottom: 2 }}>
                        {i18n.t('traffic_total')}
                    </Text>
                    <Text style={{ fontSize: 16, color: theme.text, fontWeight: '600' }}>
                        {hasData ? fmtBytes(total) : '-'}
                    </Text>
                </View>
            </View>
            <TrafficIndicator percentage={pct} color={color} hasData={hasData} textSecondaryColor={theme.textSecondary} />
        </View>
    );
}

// ─── Simplified profile list row (just name + checkmark + delete) ──────────────

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
                width: 20, height: 20, borderRadius: 10,
                borderWidth: isActive ? 0 : 2,
                borderColor: theme.border,
                backgroundColor: isActive ? '#007AFF' : 'transparent',
                alignItems: 'center', justifyContent: 'center',
            }}>
                {isActive && <Ionicons name="checkmark" size={12} color="#fff" />}
            </View>

            <Text numberOfLines={1} style={{ flex: 1, fontSize: 15, color: theme.text, fontFamily: Fonts?.sans }}>
                {sub.name}
            </Text>

            <Pressable
                onPress={() => { mediumImpact(); onDelete(); }}
                hitSlop={8}
                style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1, padding: 4 })}
            >
                <Ionicons name="trash-outline" size={18} color={theme.textSecondary} />
            </Pressable>
        </Pressable>
    );
}

// ─── Unified active profile card ──────────────────────────────────────────────

function ActiveProfileCard({
    sub,
    refreshing,
    onRefresh,
}: {
    sub: Subscription;
    refreshing: boolean;
    onRefresh: () => void;
}) {
    const theme = useTheme();
    const isZh = i18n.locale.startsWith('zh');

    const expireDate = sub.expireTime > 0
        ? new Date(sub.expireTime * 1000).toLocaleDateString(
            isZh ? 'zh-CN' : 'en-US',
            isZh
                ? { year: 'numeric', month: 'long', day: 'numeric' }
                : { year: 'numeric', month: 'short', day: 'numeric' }
        )
        : null;

    const daysLeft = sub.expireTime > 0
        ? Math.max(0, Math.ceil((sub.expireTime * 1000 - Date.now()) / 86400000))
        : null;

    const daysLeftColor = daysLeft !== null && daysLeft < 30 ? '#FF3B30' : theme.text;
    const hasData = sub.totalTraffic > 0 || sub.expireTime > 0;

    if (hasData) {
        // With data: show full card with traffic and expiry
        return (
            <Card style={{ paddingVertical: 20 }}>
                {/* Header: Name + Refresh button */}
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                    <Text style={{ fontSize: 16, fontWeight: '600', color: theme.text, flex: 1 }}>
                        {sub.name || i18n.t('remote_config')}
                    </Text>
                    <Pressable
                        disabled={refreshing}
                        onPress={() => { if (!refreshing) { mediumImpact(); onRefresh(); } }}
                        style={({ pressed }) => ({
                            opacity: refreshing ? 0.4 : (pressed ? 0.6 : 1),
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 4,
                            paddingHorizontal: 8,
                            paddingVertical: 6,
                        })}
                    >
                        <Ionicons
                            name="refresh-outline"
                            size={14}
                            color={refreshing ? theme.textSecondary : '#007AFF'}
                        />
                        <Text style={{ fontSize: 12, color: refreshing ? theme.textSecondary : '#007AFF' }}>
                            {refreshing ? i18n.t('sub_refreshing') : i18n.t('sub_refresh')}
                        </Text>
                    </Pressable>
                </View>

                {/* Info rows */}
                <View style={{ gap: 16 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Ionicons name="link-outline" size={14} color="#007AFF" />
                        <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: theme.text }}>{urlHostname(sub.url, sub.url)}</Text>
                    </View>

                    <TrafficBar used={sub.usedTraffic} total={sub.totalTraffic} />

                    {expireDate ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <Ionicons name="calendar-outline" size={14} color={daysLeftColor} />
                            <Text style={{ fontSize: 13, color: daysLeftColor }}>
                                {expireDate}
                                {daysLeft !== null && ` ${i18n.t('days_remaining', { days: daysLeft })}`}
                            </Text>
                        </View>
                    ) : (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <Ionicons name="calendar-outline" size={14} color={theme.textSecondary} />
                            <Text style={{ fontSize: 13, color: theme.textSecondary }}>
                                {i18n.t('config_no_expire')}
                            </Text>
                        </View>
                    )}
                </View>
            </Card>
        );
    }

    // No data: compact card with title, URL, and full-height refresh button
    return (
        <Card style={{ paddingVertical: 24, paddingHorizontal: 0, flexDirection: 'row', overflow: 'visible' }}>
            <View style={{ flex: 1, paddingHorizontal: 16, justifyContent: 'center', gap: 24 }}>
                <Text style={{ fontSize: 16, fontWeight: '600', color: theme.text }}>
                    {i18n.t('remote_config')}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Ionicons name="link-outline" size={14} color="#007AFF" />
                    <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: theme.text }}>
                        {urlHostname(sub.url, sub.url)}
                    </Text>
                </View>
            </View>

            <Pressable
                disabled={refreshing}
                onPress={() => { if (!refreshing) { mediumImpact(); onRefresh(); } }}
                style={({ pressed }) => ({
                    paddingHorizontal: 16,
                    justifyContent: 'center',
                    alignItems: 'center',
                    opacity: refreshing ? 0.4 : (pressed ? 0.6 : 1),
                })}
            >
                <Ionicons
                    name="refresh-outline"
                    size={24}
                    color={refreshing ? theme.textSecondary : '#007AFF'}
                />
            </Pressable>
        </Card>
    );
}


// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SubscriptionsScreen() {
    const theme = useTheme();
    const { connected } = useVpn();

    const [subs, setSubs] = useState<Subscription[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const refreshingRef = useRef(false);
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
        if (refreshingRef.current) return;
        refreshingRef.current = true;
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
            refreshingRef.current = false;
            setRefreshing(false);
        }
    }, [loadData]);

    const handleImportClose = useCallback(() => { setImportUrlVisible(false); loadData(); }, [loadData]);

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
                            onPress={() => {
                                mediumImpact();
                                setImportUrlVisible(true);
                            }}
                            style={({ pressed }) => ({
                                width: 36, height: 36, borderRadius: 18,
                                alignItems: 'center', justifyContent: 'center',
                                opacity: pressed ? 0.55 : 1,
                            })}
                            hitSlop={8}
                        >
                            <Ionicons name="add" size={22} color={theme.text} />
                        </Pressable>

                    </View>

                    {/* Scrollable content */}
                    <ScrollView
                        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingTop: 12, paddingBottom: BottomTabInset + Spacing.three, gap: 20 }}
                        showsVerticalScrollIndicator={false}
                    >
                        {subs.length === 0 ? (
                            <EmptyState
                                onScanQR={() => setImportUrlVisible(true)}
                                onImportUrl={() => setImportUrlVisible(true)}
                            />
                        ) : (
                            <View style={{ gap: 20 }}>
                                {/* Routing mode — only when profiles exist */}
                                <ModeSelector hideSectionLabel />

                                {/* Active profile card (if selected) */}
                                {activeSub && (
                                    <ActiveProfileCard
                                        sub={activeSub}
                                        refreshing={refreshing}
                                        onRefresh={handleRefresh}
                                    />
                                )}

                                {/* Profiles list */}
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
                        )}
                    </ScrollView>
                </View>
            </SafeAreaView>

            <ImportUrlModal visible={importUrlVisible} onClose={handleImportClose} />
        </ThemedView>
    );
}
