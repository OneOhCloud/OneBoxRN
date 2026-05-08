import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { notifyError, notifySuccess } from '@/components/ui/haptics';
import { EmptyState } from '@/components/ui/home/empty-state';
import { ImportUrlModal } from '@/components/ui/home/import-url-modal';
import { ModeSelector } from '@/components/ui/home/mode-selector';
import { SectionAction, SectionHeader } from '@/components/ui/ios26/section';
import { TabFocusAnimator } from '@/components/ui/tab-focus-animator';
import { useGlassSurface } from '@/constants/ios26-palette';
import { ActiveProfileCard } from '@/components/ui/profiles/active-profile-card';
import { ImportRow, ProfileRow } from '@/components/ui/profiles/profile-row';
import i18n from '@/constants/language';
import { Fonts, MaxContentWidth, TabScreenEdges } from '@/constants/theme';
import { ProfileStore } from '@/database/kv';
import { useTheme } from '@/hooks/use-theme';
import { executeConfigRefresh } from '@/tasks/config-refresh';
import { requestVpnRestart } from '@/utils/vpn-restart';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { Alert, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function ProfilesScreen() {
    const theme = useTheme();

    // Lazy-init from the store: first render already reflects real data,
    // avoiding a one-frame EmptyState → populated repaint during tab crossfade.
    const [subs, setSubs] = useState<ReturnType<typeof ProfileStore.getAll>>(() => ProfileStore.getAll());
    const [activeId, setActiveId] = useState<string | null>(() => ProfileStore.getActiveId());
    const [pullRefreshing, setPullRefreshing] = useState(false);
    const [cardRefreshing, setCardRefreshing] = useState(false);
    const refreshingRef = useRef(false);
    const [importUrlVisible, setImportUrlVisible] = useState(false);
    const [editMode, setEditMode] = useState(false);

    const loadData = useCallback(() => {
        const nextSubs = ProfileStore.getAll();
        setSubs(prev => {
            if (prev.length !== nextSubs.length) return nextSubs;
            for (let i = 0; i < prev.length; i++) {
                const a = prev[i];
                const b = nextSubs[i];
                if (
                    a.id !== b.id ||
                    a.name !== b.name ||
                    a.usedTraffic !== b.usedTraffic ||
                    a.totalTraffic !== b.totalTraffic ||
                    a.expireTime !== b.expireTime
                ) {
                    return nextSubs;
                }
            }
            return prev;
        });
        const nextActive = ProfileStore.getActiveId();
        setActiveId(prev => (prev === nextActive ? prev : nextActive));
    }, []);

    useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

    const handleActivate = useCallback((id: string) => {
        ProfileStore.setActiveId(id);
        setActiveId(id);
        // Debounced + in-flight-guarded restart. Shared with VpnContext.setMode
        // so rapid mode + profile switches coalesce into one restart per
        // quiescent period instead of racing.
        requestVpnRestart();
    }, []);

    const handleDelete = useCallback((sub: { id: string; name: string }) => {
        Alert.alert(i18n.t('sub_delete'), i18n.t('sub_delete_confirm'), [
            { text: i18n.t('cancel'), style: 'cancel' },
            { text: i18n.t('sub_delete'), style: 'destructive', onPress: () => { ProfileStore.delete(sub.id); loadData(); } },
        ]);
    }, [loadData]);

    const runRefresh = useCallback(async (setPending: (v: boolean) => void) => {
        if (refreshingRef.current) return;
        refreshingRef.current = true;
        setPending(true);
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
            setPending(false);
        }
    }, [loadData]);

    const handlePullRefresh = useCallback(() => runRefresh(setPullRefreshing), [runRefresh]);
    const handleCardRefresh = useCallback(() => runRefresh(setCardRefreshing), [runRefresh]);

    const handleImportClose = useCallback(() => { setImportUrlVisible(false); loadData(); }, [loadData]);

    const activeSub = subs.find(s => s.id === activeId) ?? null;
    const hasProfiles = subs.length > 0;
    const glass = useGlassSurface();

    // Empty state matches the shape of src/app/(tabs)/index.tsx's empty state
    // (same wrapper, same padding) so tab switches align pixel-perfectly.
    if (!hasProfiles) {
        return (
            <ThemedView style={{ flex: 1, flexDirection: 'row', justifyContent: 'center' }}>
                <SafeAreaView
                    edges={TabScreenEdges}
                    style={{
                        flex: 1,
                        maxWidth: MaxContentWidth,
                        paddingHorizontal: 16,
                        justifyContent: 'center',
                    }}
                >
                    <TabFocusAnimator variant="fadeDown">
                        <EmptyState onImportUrl={() => setImportUrlVisible(true)} />
                    </TabFocusAnimator>
                </SafeAreaView>
                <ImportUrlModal visible={importUrlVisible} onClose={handleImportClose} />
            </ThemedView>
        );
    }

    return (
        <ThemedView style={{ flex: 1, flexDirection: 'row', justifyContent: 'center' }}>
            <SafeAreaView
                edges={TabScreenEdges}
                style={{
                    flex: 1,
                    maxWidth: MaxContentWidth,
                }}
            >
                <TabFocusAnimator variant="fadeDown">
                <View
                    style={{
                        paddingHorizontal: 20,
                        paddingTop: 12,
                        paddingBottom: 12,
                    }}
                >
                    <ThemedText
                        style={{
                            fontSize: 34,
                            fontFamily: Fonts?.rounded,
                            fontWeight: '800',
                            letterSpacing: -0.9,
                            lineHeight: 41,
                        }}
                    >
                        {i18n.t('sub_title')}
                    </ThemedText>
                </View>

                <ScrollView
                    contentContainerStyle={{
                        flexGrow: 1,
                        paddingHorizontal: 16,
                        paddingTop: 4,
                        gap: 24,
                    }}
                    showsVerticalScrollIndicator={false}
                    refreshControl={
                        <RefreshControl
                            refreshing={pullRefreshing}
                            onRefresh={handlePullRefresh}
                            tintColor={theme.textSecondary}
                        />
                    }
                >
                    {activeSub && (
                        <ActiveProfileCard
                            sub={activeSub}
                            refreshing={cardRefreshing}
                            onRefresh={handleCardRefresh}
                        />
                    )}

                    <View>
                        <SectionHeader label={i18n.t('routing_mode')} />
                        <View style={[glass, { padding: 12 }]}>
                            <ModeSelector />
                        </View>
                    </View>

                    <View>
                        <SectionHeader
                            label={i18n.t('sub_section_list')}
                            trailing={
                                <SectionAction
                                    label={editMode ? i18n.t('done') : i18n.t('edit')}
                                    active={editMode}
                                    onPress={() => setEditMode(e => !e)}
                                />
                            }
                        />
                        <View style={[glass, { paddingVertical: 4 }]}>
                            {subs.map((sub) => (
                                <ProfileRow
                                    key={sub.id}
                                    sub={sub}
                                    isActive={sub.id === activeId}
                                    editMode={editMode}
                                    onActivate={() => handleActivate(sub.id)}
                                    onDelete={() => handleDelete(sub)}
                                />
                            ))}
                            <ImportRow
                                isLast
                                onPress={() => setImportUrlVisible(true)}
                            />
                        </View>
                    </View>
                </ScrollView>
                </TabFocusAnimator>
            </SafeAreaView>

            <ImportUrlModal visible={importUrlVisible} onClose={handleImportClose} />
        </ThemedView>
    );
}
