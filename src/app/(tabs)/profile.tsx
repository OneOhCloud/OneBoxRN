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
import { ProfileStore, type Profile } from '@/database/kv';
import { useTheme } from '@/hooks/use-theme';
import { useVpn } from '@/contexts/vpn-context';
import { executeConfigRefresh } from '@/tasks/config-refresh';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { Alert, FlatList, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type SegmentPosition = 'first' | 'middle' | 'last';

export default function ProfilesScreen() {
    const theme = useTheme();
    const { requestRestart } = useVpn();

    // 从 store 惰性初始化：首帧就反映真实数据，
    // 避免 tab 交叉淡入时出现一帧 EmptyState → 有数据的重绘。
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
        // 带防抖 + 进行中守卫的重启。与 VpnContext.setMode 共用，
        // 使快速的模式 + 配置切换合并为每个静默期一次重启，而非相互竞争。
        requestRestart();
    }, [requestRestart]);

    const handleDelete = useCallback((sub: { id: string; name: string }) => {
        Alert.alert(i18n.t('profile_delete'), i18n.t('profile_delete_confirm'), [
            { text: i18n.t('cancel'), style: 'cancel' },
            { text: i18n.t('profile_delete'), style: 'destructive', onPress: () => { ProfileStore.delete(sub.id); loadData(); } },
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
                Alert.alert(i18n.t('profile_refresh_failed'), result?.error ?? '');
            }
        } catch (e: unknown) {
            notifyError();
            Alert.alert(i18n.t('profile_refresh_failed'), e instanceof Error ? e.message : '');
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

    // 配置文件列表是虚拟化的（FlatList），所以把单张玻璃卡片拆成逐行的分段：
    // 两侧边框每行都有，圆角顶部只在首行，圆角底部 + iOS 阴影只在页脚分段
    // （逐段阴影会在接缝处叠加；offset y=10 / radius 24 的阴影落在卡片下方，
    // 因此只在页脚放阴影即可近似单卡片的观感）。
    const glassSegment = useCallback((position: SegmentPosition) => {
        const borderColor = 'borderColor' in glass ? glass.borderColor : undefined;
        return [
            { backgroundColor: glass.backgroundColor },
            borderColor !== undefined
                ? { borderColor, borderLeftWidth: 1, borderRightWidth: 1 }
                : null,
            position === 'first' && {
                borderTopLeftRadius: glass.borderRadius,
                borderTopRightRadius: glass.borderRadius,
                paddingTop: 4,
                ...(borderColor !== undefined ? { borderTopWidth: 1 } : null),
            },
            position === 'last' && {
                borderBottomLeftRadius: glass.borderRadius,
                borderBottomRightRadius: glass.borderRadius,
                paddingBottom: 4,
                ...(borderColor !== undefined ? { borderBottomWidth: 1 } : null),
                ...('shadowColor' in glass
                    ? {
                        shadowColor: glass.shadowColor,
                        shadowOffset: glass.shadowOffset,
                        shadowOpacity: glass.shadowOpacity,
                        shadowRadius: glass.shadowRadius,
                    }
                    : null),
            },
        ];
    }, [glass]);

    const renderProfile = useCallback(({ item, index }: { item: Profile; index: number }) => (
        <View style={glassSegment(index === 0 ? 'first' : 'middle')}>
            <ProfileRow
                sub={item}
                isActive={item.id === activeId}
                editMode={editMode}
                onActivate={() => handleActivate(item.id)}
                onDelete={() => handleDelete(item)}
            />
        </View>
    ), [glassSegment, activeId, editMode, handleActivate, handleDelete]);

    // 空状态与 src/app/(tabs)/index.tsx 的空状态形状一致
    // （同样的包裹、同样的 padding），使 tab 切换像素级对齐。
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
                        {i18n.t('profile_title')}
                    </ThemedText>
                </View>

                <FlatList
                    data={subs}
                    keyExtractor={(sub) => sub.id}
                    renderItem={renderProfile}
                    // 用 JSX 元素（而非内联组件），使 header/footer
                    // 保持类型标识，跨渲染时不会重新挂载。
                    ListHeaderComponent={
                        <View style={{ gap: 24 }}>
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
                            <SectionHeader
                                label={i18n.t('profile_section_list')}
                                trailing={
                                    <SectionAction
                                        label={editMode ? i18n.t('done') : i18n.t('edit')}
                                        active={editMode}
                                        onPress={() => setEditMode(e => !e)}
                                    />
                                }
                            />
                        </View>
                    }
                    ListFooterComponent={
                        <View style={glassSegment('last')}>
                            <ImportRow
                                isLast
                                onPress={() => setImportUrlVisible(true)}
                            />
                        </View>
                    }
                    contentContainerStyle={{
                        flexGrow: 1,
                        paddingHorizontal: 16,
                        paddingTop: 4,
                    }}
                    showsVerticalScrollIndicator={false}
                    refreshControl={
                        <RefreshControl
                            refreshing={pullRefreshing}
                            onRefresh={handlePullRefresh}
                            tintColor={theme.textSecondary}
                        />
                    }
                />
                </TabFocusAnimator>
            </SafeAreaView>

            <ImportUrlModal visible={importUrlVisible} onClose={handleImportClose} />
        </ThemedView>
    );
}
