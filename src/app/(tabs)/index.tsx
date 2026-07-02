/**
 * Home Screen — VPN control hub.
 * Primary user tasks: connect/disconnect, select proxy node, import profile.
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
 * Left-to-right wipe transition between two children.
 * Must stay mounted across parent re-renders for the animation to play.
 *
 * A ghost element (normal flow) holds height. Two absolutely-positioned
 * overflow:hidden clips drive the wipe: new grows left→right, old shrinks left→right.
 * widthShared is a Reanimated shared value so worklets can read it on the UI thread.
 */
const HAZE_W = 72;
const CARD_RADIUS = 22;
// Opacity ramps for the frosted-glass haze strip. LTR: dense at right edge (near glow line). RTL: reversed.
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
            // No animation on mount — jump to settled state
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

    // Layout-prop animation exemption (audit F-09, docs/claude/
    // terminology-exceptions.md → animation exemptions): this wipe reveal is
    // intrinsically a clip animation — width/left ARE the effect. It runs only
    // on rare state flips (config presence / connected wipe, ~1.4 s), is
    // driven by Reanimated on the UI thread, and a transform-only rework would
    // need nested counter-translations for both layers plus re-deriving the
    // pixel-aligned glow/haze `left` tracking. Measured-safe; keep as-is.
    const newClipStyle = useAnimatedStyle(() => ({
        width: progress.value * widthShared.value,
    }));
    const oldClipStyle = useAnimatedStyle(() => ({
        width: (1 - progress.value) * widthShared.value,
    }));
    // Glow line: tracks wipe edge, only rendered during transition
    const maskStyle = useAnimatedStyle(() => ({
        left: progress.value * widthShared.value - 1,
    }));
    // Haze on NEW content side — full opacity while transitioning (visibility gated by {transitioning})
    //   showSecond=true  → L→R → new content LEFT of glow line  → haze ends at glow line, extends left
    //   showSecond=false → R→L → new content RIGHT of glow line → haze starts at glow line, extends right
    const hazeStyle = useAnimatedStyle(() => ({
        left: showSecond
            ? progress.value * widthShared.value - HAZE_W   // left of glow line (new content side)
            : progress.value * widthShared.value,            // right of glow line (new content side)
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
        // overflow:hidden + borderRadius clips everything (including abs layers) to card shape
        <View style={{ borderRadius: CARD_RADIUS, overflow: 'hidden' }}>
            {/* Ghost: normal-flow height anchor; visible until width is measured */}
            <View
                style={{ opacity: ready ? 0 : 1, height: ready ? H : undefined }}
                pointerEvents={ready ? 'none' : 'auto'}
                onLayout={onGhostLayout}
            >
                {ready ? null : (showSecond ? second : first)}
            </View>

            {ready && (
                <>
                    {/* Old — right-anchored, shrinks leftward */}
                    <Animated.View
                        style={[{ position: 'absolute', right: 0, top: 0, bottom: 0, overflow: 'hidden' }, oldClipStyle]}
                        pointerEvents={showSecond ? 'none' : 'auto'}
                    >
                        <View style={{ position: 'absolute', right: 0, width: W }}>
                            {first}
                        </View>
                    </Animated.View>

                    {/* New — left-anchored, grows rightward */}
                    <Animated.View
                        style={[{ position: 'absolute', left: 0, top: 0, bottom: 0, overflow: 'hidden' }, newClipStyle]}
                        pointerEvents={showSecond ? 'auto' : 'none'}
                    >
                        <View style={{ width: W }}>
                            {second}
                        </View>
                    </Animated.View>

                    {/* Haze + glow — only rendered while animation is active */}
                    {transitioning && (
                        <>
                            {/* Silver-gray haze on new content side — simulates frosted glass revealing.
                                Dense at glow line, fades into the new content. */}
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

                            {/* 1px glow line at exact wipe edge */}
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
        subInfo,
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
        error: nodeError,
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
                error={nodeError}
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
                            {/* Button + speed row — always mounted, props vary by state */}
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

                            {/* Middle slot — WipeSlot stays mounted across connection changes */}
                            <WipeSlot
                                first={importCard}
                                second={nodeListCard}
                                showSecond={connected}
                                edgeColor={accent}
                            />

                            {/* Profile card — always mounted, connected prop varies */}
                            <ProfileSummaryCard
                                info={subInfo}
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
