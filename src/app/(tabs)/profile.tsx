/**
 * Profiles Screen — routing mode selector + multi-profile management.
 * Redesigned with unified active profile card + simplified profile list.
 */
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { notifyError, notifySuccess } from '@/components/ui/haptics';
import { EmptyState } from '@/components/ui/home/empty-state';
import { ImportUrlModal } from '@/components/ui/home/import-url-modal';
import { ModeSelector } from '@/components/ui/home/mode-selector';
import { SectionAction, SectionHeader } from '@/components/ui/ios26/section';
import { ActiveProfileCard, useGlassSurface } from '@/components/ui/profiles/active-profile-card';
import { ImportRow, ProfileRow } from '@/components/ui/profiles/profile-row';
import i18n from '@/constants/language';
import { BottomTabInset, Fonts, MaxContentWidth, Spacing } from '@/constants/theme';
import { getProcessedConfig } from '@/database/helper';
import { ProfileStore } from '@/database/kv';
import { useTheme } from '@/hooks/use-theme';
import ExpoOneBox, { VPN_STATUS } from '@/modules/expo-onebox';
import { executeConfigRefresh } from '@/tasks/config-refresh';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { Alert, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// SectionHeader / SectionAction are imported from @/components/ui/ios26/section
// so every tab screen shares identical metrics. Do not re-declare locally.

export default function ProfilesScreen() {
    const theme = useTheme();

    // Lazy-init from the store so the first render already reflects real data —
    // avoids a one-frame EmptyState → populated repaint during the tab crossfade.
    const [subs, setSubs] = useState<ReturnType<typeof ProfileStore.getAll>>(() => ProfileStore.getAll());
    const [activeId, setActiveId] = useState<string | null>(() => ProfileStore.getActiveId());
    const [refreshing, setRefreshing] = useState(false);
    const refreshingRef = useRef(false);
    const [importUrlVisible, setImportUrlVisible] = useState(false);
    const [editMode, setEditMode] = useState(false);

    // Guarded setters: only commit a new state if something actually changed.
    // This makes no-op refocuses (common when bouncing between tabs) truly
    // free of re-renders, eliminating flicker on tab transitions.
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

    const hasProfiles = subs.length > 0;
    const glass = useGlassSurface();

    // Empty-state short path: renders the exact same tree as
    // src/app/(tabs)/index.tsx's empty state — ThemedView → SafeAreaView →
    // EmptyState, no ScrollView. This is the only way to guarantee the two
    // tabs align pixel-perfectly when switching between them in empty state.
    if (!hasProfiles) {
        return (
            <ThemedView style={{ flex: 1, flexDirection: 'row', justifyContent: 'center' }}>
                <SafeAreaView
                    style={{
                        flex: 1,
                        maxWidth: MaxContentWidth,
                        paddingHorizontal: 16,
                        paddingBottom: BottomTabInset + Spacing.two,
                        justifyContent: 'center',
                    }}
                >
                    <EmptyState onImportUrl={() => setImportUrlVisible(true)} />
                </SafeAreaView>
                <ImportUrlModal visible={importUrlVisible} onClose={handleImportClose} />
            </ThemedView>
        );
    }

    return (
        // Populated layout: masthead + ScrollView. The SafeAreaView + maxWidth
        // wrapper stays identical to the empty path above and to the Home tab,
        // so the top edge of the first content row is always at the same Y.
        <ThemedView style={{ flex: 1, flexDirection: 'row', justifyContent: 'center' }}>
            <SafeAreaView
                style={{
                    flex: 1,
                    maxWidth: MaxContentWidth,
                    paddingBottom: BottomTabInset + Spacing.two,
                }}
            >

                    {/* ── Masthead — hidden when there are no profiles, so the
                        empty state takes over the full screen. ── */}
                    {hasProfiles && (
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
                    )}

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
                                refreshing={refreshing}
                                onRefresh={handleRefresh}
                                tintColor={theme.textSecondary}
                            />
                        }
                    >
                        {/* Hero — Liquid Glass card with integrated refresh button */}
                        {activeSub && (
                            <ActiveProfileCard
                                sub={activeSub}
                                refreshing={refreshing}
                                onRefresh={handleRefresh}
                            />
                        )}

                        {/* Routing mode */}
                        <View>
                            <SectionHeader label={i18n.t('routing_mode')} />
                            <View style={[glass, { padding: 12 }]}>
                                <ModeSelector hideSectionLabel />
                            </View>
                        </View>

                        {/* Profile list — Edit pill sits in the section header */}
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
                                        isLast={false}
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
            </SafeAreaView>

            <ImportUrlModal visible={importUrlVisible} onClose={handleImportClose} />
        </ThemedView>
    );
}
