/**
 * 主页屏幕 — VPN 控制中枢。
 * 用户主要操作：连接/断开、选择代理节点、导入配置文件。
 */
import { ThemedView } from '@/components/themed-view';
import { ConnectButton } from '@/components/ui/home/connect-button';
import { EmptyState } from '@/components/ui/home/empty-state';
import { selectionChanged } from '@/components/ui/haptics';
import { FAB_CLEARANCE } from '@/components/ui/home/import-fab';
import { ImportUrlModal } from '@/components/ui/home/import-url-modal';
import { NodeList } from '@/components/ui/home/node-list';
import { NodePickerSheet, type NodePickerSheetHandle } from '@/components/ui/home/node-picker-sheet';
import { ProfileSummaryCard } from '@/components/ui/home/profile-summary-card';
import { SpeedRow } from '@/components/ui/home/speed-row';
import { TabFocusAnimator } from '@/components/ui/tab-focus-animator';
import { useAccentBlue, useGlassSurface } from '@/constants/ios26-palette';
import i18n from '@/constants/language';
import { Fonts, MaxContentWidth, TabScreenEdges } from '@/constants/theme';
import { useVpn } from '@/contexts/vpn-context';
import { ProfileStore } from '@/database/kv';
import { useHomeScreen } from '@/hooks/use-home-screen';
import { useProxyNodes } from '@/hooks/use-proxy-nodes';
import { useTheme } from '@/hooks/use-theme';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, LayoutChangeEvent, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import Animated, {
    Easing,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * 两个子节点之间从左到右的擦除过渡。
 * 必须在父组件重渲染期间保持挂载，动画才能播放。
 *
 * 一个 ghost 元素（正常文档流）撑起高度。两个绝对定位的 overflow:hidden
 * 裁剪层驱动擦除：新内容从左向右生长，旧内容从左向右收缩。
 * widthShared 是 Reanimated shared value，好让 worklet 在 UI 线程读取它。
 */
const HAZE_W = 72;
const CARD_RADIUS = 22;
// 磨砂玻璃雾化条的不透明度梯度。LTR：右缘（靠近辉光线）最浓。RTL：反向。
const HAZE_LTR = [0.01, 0.02, 0.06, 0.12, 0.20, 0.32, 0.46, 0.60];
const HAZE_RTL = [0.60, 0.46, 0.32, 0.20, 0.12, 0.06, 0.02, 0.01];

function WipeSlot({
    first,
    second,
    showSecond,
    edgeColor = '#ffffff',
}: {
    first: React.ReactNode;
    second: React.ReactNode;
    showSecond: boolean;
    edgeColor?: string;
}) {
    const progress = useSharedValue(showSecond ? 1 : 0);
    const widthShared = useSharedValue(0);
    const [ready, setReady] = useState(false);
    const [W, setW] = useState(0);
    const [transitioning, setTransitioning] = useState(false);
    const [H, setH] = useState(0);
    const isFirstMount = useRef(true);

    useEffect(() => {
        if (isFirstMount.current) {
            isFirstMount.current = false;
            // 挂载时不做动画 —— 直接跳到稳定状态
            progress.value = showSecond ? 1 : 0;
            return;
        }
        setTransitioning(true);
        progress.value = withTiming(showSecond ? 1 : 0, {
            duration: showSecond ? 1400 : 620,
            easing: Easing.inOut(Easing.ease),
        }, (finished) => {
            if (finished) runOnJS(setTransitioning)(false);
        });
    }, [showSecond, progress]);

    // 布局属性动画豁免（见 docs/claude/terminology-exceptions.md → animation
    // exemptions）：这个擦除揭示本质上就是裁剪动画 —— width/left 本身就是效果。
    // 它只在罕见的状态翻转时运行（配置有无 / 连接擦除，约 1.4s），由 Reanimated
    // 在 UI 线程驱动；改成纯 transform 需要为两层做嵌套反向平移，还要重新推导
    // 像素对齐的 glow/haze `left` 跟踪。保持现状。
    const newClipStyle = useAnimatedStyle(() => ({
        width: progress.value * widthShared.value,
    }));
    const oldClipStyle = useAnimatedStyle(() => ({
        width: (1 - progress.value) * widthShared.value,
    }));
    // 辉光线：跟踪擦除边缘，仅在过渡期间渲染
    const maskStyle = useAnimatedStyle(() => ({
        left: progress.value * widthShared.value - 1,
    }));
    // 新内容一侧的雾化 —— 过渡期间满不透明度（可见性由 {transitioning} 门控）
    //   showSecond=true  → L→R → 新内容在辉光线左侧 → 雾化止于辉光线，向左延伸
    //   showSecond=false → R→L → 新内容在辉光线右侧 → 雾化始于辉光线，向右延伸
    const hazeStyle = useAnimatedStyle(() => ({
        left: showSecond
            ? progress.value * widthShared.value - HAZE_W   // 辉光线左侧（新内容一侧）
            : progress.value * widthShared.value,            // 辉光线右侧（新内容一侧）
    }));

    const onGhostLayout = (e: LayoutChangeEvent) => {
        const w = e.nativeEvent.layout.width;
        const h = e.nativeEvent.layout.height;
        if (w > 0 && w !== widthShared.value) {
            widthShared.value = w;
            setW(w);
            setReady(true);
        }
        if (h > 0 && h !== H) {
            setH(h);
        }
    };

    return (
        // overflow:hidden + borderRadius 把一切（含绝对定位层）裁剪成卡片形状
        <View style={{ borderRadius: CARD_RADIUS, overflow: 'hidden' }}>
            {/* Ghost：正常文档流的高度锚点；宽度测量完成前一直可见 */}
            <View
                style={{ opacity: ready ? 0 : 1, height: ready ? H : undefined }}
                pointerEvents={ready ? 'none' : 'auto'}
                onLayout={onGhostLayout}
            >
                {ready ? null : (showSecond ? second : first)}
            </View>

            {ready && (
                <>
                    {/* 旧内容 —— 右侧锚定，向左收缩 */}
                    <Animated.View
                        style={[{ position: 'absolute', right: 0, top: 0, bottom: 0, overflow: 'hidden' }, oldClipStyle]}
                        pointerEvents={showSecond ? 'none' : 'auto'}
                    >
                        <View style={{ position: 'absolute', right: 0, width: W }}>
                            {first}
                        </View>
                    </Animated.View>

                    {/* 新内容 —— 左侧锚定，向右生长 */}
                    <Animated.View
                        style={[{ position: 'absolute', left: 0, top: 0, bottom: 0, overflow: 'hidden' }, newClipStyle]}
                        pointerEvents={showSecond ? 'auto' : 'none'}
                    >
                        <View style={{ width: W }}>
                            {second}
                        </View>
                    </Animated.View>

                    {/* 雾化 + 辉光 —— 仅在动画进行时渲染 */}
                    {transitioning && (
                        <>
                            {/* 新内容一侧的银灰色雾化 —— 模拟磨砂玻璃逐渐揭示。
                                在辉光线处最浓，向新内容淡出。 */}
                            <Animated.View
                                pointerEvents="none"
                                style={[{
                                    position: 'absolute', top: 0, bottom: 0,
                                    width: HAZE_W,
                                    flexDirection: 'row',
                                }, hazeStyle]}
                            >
                                {(showSecond ? HAZE_LTR : HAZE_RTL).map((a, i) => (
                                    <View
                                        key={i}
                                        style={{ flex: 1, backgroundColor: `rgba(210,220,255,${a})` }}
                                    />
                                ))}
                            </Animated.View>

                            {/* 精确位于擦除边缘的 1px 辉光线 */}
                            <Animated.View
                                pointerEvents="none"
                                style={[{
                                    position: 'absolute', top: 0, bottom: 0,
                                    width: 1,
                                    backgroundColor: `${edgeColor}CC`,
                                }, maskStyle]}
                            />
                        </>
                    )}
                </>
            )}
        </View>
    );
}

export default function HomeScreen() {
    const {
        connected,
        loading,
        hasConfig,
        profileQuota,
        profileName,
        importUrlVisible,
        setImportUrlVisible,
        handleToggleConnect,
        handleImportUrlClose,
    } = useHomeScreen();

    const theme = useTheme();
    const accent = useAccentBlue();
    const glass = useGlassSurface();
    const nodeSheetRef = useRef<NodePickerSheetHandle>(null);
    const [activeProfileId, setActiveProfileId] = useState<string | null>(() => ProfileStore.getActiveId());
    useFocusEffect(
        useCallback(() => {
            setActiveProfileId(ProfileStore.getActiveId());
        }, [])
    );
    const { selectNode } = useVpn();
    const {
        nodes,
        currentNode,
        autoResolvedNode,
        isLoading: isNodeLoading,
    } = useProxyNodes(connected, activeProfileId);

    const openNodePicker = useCallback(() => {
        nodeSheetRef.current?.present();
    }, []);

    const handleNodeSelect = useCallback(async (tag: string) => {
        nodeSheetRef.current?.dismiss();
        selectionChanged();
        const result = await selectNode(tag);
        if (!result.ok) {
            Alert.alert(i18n.t('node_switch_failed'), result.message || i18n.t('request_failed'));
        }
    }, [selectNode]);

    const speedOpacity = useSharedValue(connected ? 1 : 0);
    useEffect(() => {
        speedOpacity.value = withTiming(connected ? 1 : 0, { duration: 400, easing: Easing.inOut(Easing.ease) });
    }, [connected]); // eslint-disable-line react-hooks/exhaustive-deps
    const speedRowStyle = useAnimatedStyle(() => ({ opacity: speedOpacity.value }));

    if (!hasConfig && Platform.OS !== 'web') {
        return (
            <ThemedView style={{ flex: 1, flexDirection: 'row', justifyContent: 'center' }}>
                <SafeAreaView
                    edges={TabScreenEdges}
                    style={{ flex: 1, maxWidth: MaxContentWidth, paddingHorizontal: 16, justifyContent: 'center' }}
                >
                    <TabFocusAnimator variant="fade">
                        <EmptyState onImportUrl={() => setImportUrlVisible(true)} />
                    </TabFocusAnimator>
                </SafeAreaView>
                <ImportUrlModal visible={importUrlVisible} onClose={handleImportUrlClose} />
            </ThemedView>
        );
    }

    const importCard = (
        <View style={[glass, { paddingHorizontal: 20, paddingVertical: 16 }]}>
            <Pressable
                onPress={() => setImportUrlVisible(true)}
                style={({ pressed }) => ({
                    flexDirection: 'row', alignItems: 'center',
                    paddingHorizontal: 4, paddingVertical: 4, gap: 12,
                    opacity: pressed ? 0.6 : 1,
                })}
            >
                <View style={{ flex: 1, gap: 4 }}>
                    <Text style={{ fontSize: 9, fontWeight: '700', letterSpacing: 1.3, opacity: 0.7, color: theme.textSecondary, fontFamily: Fonts?.sans }}>
                        {i18n.t('import_profile').toUpperCase()}
                    </Text>
                    <Text style={{ fontSize: 19, fontWeight: '600', letterSpacing: -0.4, color: theme.text, fontFamily: Fonts?.rounded }}>
                        {i18n.t('import_url')}
                    </Text>
                </View>
                <Ionicons name="add" size={22} color={accent} />
            </Pressable>
        </View>
    );

    const nodeListCard = (
        <View style={[glass, { paddingHorizontal: 20, paddingVertical: 16 }]}>
            <NodeList
                nodes={nodes}
                currentNode={currentNode}
                isLoading={isNodeLoading}
                onOpenPicker={openNodePicker}
            />
        </View>
    );

    return (
        <ThemedView style={{ flex: 1, flexDirection: 'row', justifyContent: 'center' }}>
            <SafeAreaView edges={TabScreenEdges} style={{ flex: 1, maxWidth: MaxContentWidth }}>
                <TabFocusAnimator variant="fade">
                    <View style={{ flex: 1 }}>
                        <ScrollView
                            showsVerticalScrollIndicator={false}
                            contentContainerStyle={{
                                flexGrow: 1,
                                paddingHorizontal: 16,
                                paddingTop: 8,
                                paddingBottom: connected ? FAB_CLEARANCE : 24,
                                gap: 24,
                            }}
                        >
                            {/* 按钮 + 速率行 —— 始终挂载，props 随状态变化 */}
                            <View style={{ alignItems: 'center', paddingTop: 24, paddingBottom: 4, gap: 18 }}>
                                <ConnectButton
                                    connected={connected}
                                    loading={loading}
                                    onPress={handleToggleConnect}
                                />
                                <Animated.View style={speedRowStyle} pointerEvents={connected ? 'auto' : 'none'}>
                                    <SpeedRow />
                                </Animated.View>
                            </View>

                            {/* 中间槽位 —— WipeSlot 在连接状态变化期间保持挂载 */}
                            <WipeSlot
                                first={importCard}
                                second={nodeListCard}
                                showSecond={connected}
                                edgeColor={accent}
                            />

                            {/* 配置文件卡片 —— 始终挂载，connected prop 变化 */}
                            <ProfileSummaryCard
                                info={profileQuota}
                                name={profileName}
                                connected={connected}
                            />
                        </ScrollView>
                    </View>
                </TabFocusAnimator>
            </SafeAreaView>

            <ImportUrlModal visible={importUrlVisible} onClose={handleImportUrlClose} />
            <NodePickerSheet
                ref={nodeSheetRef}
                nodes={nodes}
                currentNode={currentNode}
                autoResolvedNode={autoResolvedNode}
                onSelect={handleNodeSelect}
            />
        </ThemedView>
    );
}
