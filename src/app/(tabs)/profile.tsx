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
import { ActiveProfileCard } from '@/components/ui/profiles/active-profile-card';
import { ProfileRow } from '@/components/ui/profiles/profile-row';
import i18n from '@/constants/language';
import { BottomTabInset, Fonts, MaxContentWidth, Spacing } from '@/constants/theme';
import { useVpn } from '@/contexts/vpn-context';
import { getProcessedConfig } from '@/database/helper';
import { ProfileStore } from '@/database/kv';
import { useTheme } from '@/hooks/use-theme';
import ExpoOneBox, { VPN_STATUS } from '@/modules/expo-onebox';
import { executeConfigRefresh } from '@/tasks/config-refresh';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function ProfilesScreen() {
    const theme = useTheme();
    const { connected } = useVpn();

    const [subs, setSubs] = useState<ReturnType<typeof ProfileStore.getAll>>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const refreshingRef = useRef(false);
    const [importUrlVisible, setImportUrlVisible] = useState(false);

    const loadData = useCallback(() => {
        setSubs(ProfileStore.getAll());
        setActiveId(ProfileStore.getActiveId());
    }, []);

    useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

    const handleActivate = useCallback((id: string) => {
        ProfileStore.setActiveId(id);
        setActiveId(id);

        // If VPN is running, restart with the new profile's config
        const currentStatus = ExpoOneBox.getStatus();
        if (currentStatus !== VPN_STATUS.STARTED && currentStatus !== VPN_STATUS.STARTING) return;

        const STOP_TIMEOUT_MS = 10_000;
        let done = false;
        const proceed = () => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            sub.remove();
            getProcessedConfig()
                .then(config => ExpoOneBox.start(config))
                .catch(e => console.warn('[VPN] Profile switch restart failed:', e));
        };
        const sub = ExpoOneBox.addListener('onStatusChange', (e) => {
            if (e.status === VPN_STATUS.STOPPED) proceed();
        });
        const timer = setTimeout(() => {
            console.warn('[VPN] Profile switch: stop timeout, restarting anyway');
            proceed();
        }, STOP_TIMEOUT_MS);
        ExpoOneBox.stop().catch(() => setTimeout(proceed, 300));
    }, []);

    const handleDelete = useCallback((sub: { id: string; name: string }) => {
        Alert.alert(i18n.t('sub_delete'), i18n.t('sub_delete_confirm'), [
            { text: i18n.t('cancel'), style: 'cancel' },
            { text: i18n.t('sub_delete'), style: 'destructive', onPress: () => { ProfileStore.delete(sub.id); loadData(); } },
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
                            <View style={{ gap: 32 }}>
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

                                {/* Import button */}
                                <Pressable
                                    onPress={() => { mediumImpact(); setImportUrlVisible(true); }}
                                    style={({ pressed }) => ({
                                        flexDirection: 'row' as const,
                                        alignItems: 'center' as const,
                                        justifyContent: 'center' as const,
                                        gap: 6,
                                        backgroundColor: theme.glassBackground,
                                        borderRadius: 20,
                                        borderWidth: 0.5,
                                        borderColor: theme.glassBorder,
                                        paddingVertical: 14,
                                        marginTop: 8,
                                        opacity: pressed ? 0.6 : 1,
                                    })}
                                >
                                    <Ionicons name="add" size={18} color={theme.textSecondary} />
                                    <ThemedText style={{ fontSize: 15, fontWeight: '500' }} themeColor="textSecondary">
                                        {i18n.t('import_subscription')}
                                    </ThemedText>
                                </Pressable>

                                {/* Profiles list */}
                                <View style={{
                                    backgroundColor: theme.glassBackground,
                                    borderRadius: 20,
                                    paddingHorizontal: 16,
                                    borderWidth: 0.5,
                                    borderColor: theme.glassBorder,
                                }}>
                                    {subs.map((sub, idx) => (
                                        <ProfileRow
                                            key={sub.id}
                                            sub={sub}
                                            isActive={sub.id === activeId}
                                            isFirst={idx === 0}
                                            isLast={idx === subs.length - 1}
                                            onActivate={() => handleActivate(sub.id)}
                                            onDelete={() => handleDelete(sub)}
                                        />
                                    ))}
                                </View>
                            </View>
                        )}
                    </ScrollView>
                </View>
            </SafeAreaView>

            <ImportUrlModal visible={importUrlVisible} onClose={handleImportClose} />
        </ThemedView>
    );
}
