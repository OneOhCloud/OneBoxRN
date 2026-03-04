/**
 * Home Screen — VPN control hub.
 * Primary user tasks: connect/disconnect, select proxy node, import subscription.
 */
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import CameraQR from '@/components/ui/camera-qr';
import { ConnectButton } from '@/components/ui/home/connect-button';
import { EmptyState } from '@/components/ui/home/empty-state';
import { ImportFAB } from '@/components/ui/home/import-fab';
import { ImportUrlModal } from '@/components/ui/home/import-url-modal';
import { NodeList } from '@/components/ui/home/node-list';
import { SpeedRow } from '@/components/ui/home/speed-row';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useVpn } from '@/contexts/vpn-context';
import { getProcessedConfig } from '@/database/helper';
import { SBConfig } from '@/database/kv';
import { useTheme } from '@/hooks/use-theme';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Modal, Platform, View } from 'react-native';
import Animated, {
    FadeIn,
    FadeInDown,
    FadeOut,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
    CheckVpnPermission,
    RequestVpnPermission,
    Start,
    Stop,
    VPN_STATUS
} from '../../modules/expo-onebox';

// ─────────────────────────────────────────────────────────────
// Home Screen
// ─────────────────────────────────────────────────────────────

export default function HomeScreen() {
    const theme = useTheme();
    const { connected, status } = useVpn();

    const [localLoading, setLocalLoading] = useState(false);
    const loading =
        localLoading || status === VPN_STATUS.STARTING || status === VPN_STATUS.STOPPING;

    const [hasConfig, setHasConfig] = useState<boolean>(() => !!SBConfig.getConfigContent());
    const [cameraVisible, setCameraVisible] = useState(false);
    const [importUrlVisible, setImportUrlVisible] = useState(false);

    // Refresh config flag whenever screen is focused after first render
    const isMounted = useRef(false);
    useFocusEffect(
        useCallback(() => {
            if (isMounted.current) {
                setHasConfig(!!SBConfig.getConfigContent());
            } else {
                isMounted.current = true;
            }
        }, [])
    );

    // Subtle vertical float when state changes
    const floatY = useSharedValue(0);
    useEffect(() => {
        floatY.value = withSpring(connected ? -12 : 0, { damping: 20, stiffness: 160 });
    }, [connected]);
    const floatStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: floatY.value }],
    }));

    // ── Handlers ───────────────────────────────────────────────

    const handleToggleConnect = useCallback(async () => {
        if (loading) return;
        setLocalLoading(true);
        try {
            if (connected) {
                await Stop();
            } else {
                if (Platform.OS === 'android') {
                    const hasPermission = await CheckVpnPermission();
                    if (!hasPermission) {
                        const granted = await RequestVpnPermission();
                        if (!granted) {
                            Alert.alert('权限不足', '需要 VPN 权限才能连接');
                            return;
                        }
                    }
                }
                const config = await getProcessedConfig();
                await Start(config);
            }
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : '操作失败';
            Alert.alert('错误', msg);
        } finally {
            setLocalLoading(false);
        }
    }, [connected, loading]);

    const handleCameraClose = useCallback(() => {
        setCameraVisible(false);
        setHasConfig(!!SBConfig.getConfigContent());
    }, []);

    const handleImportUrlClose = useCallback(() => {
        setImportUrlVisible(false);
        setHasConfig(!!SBConfig.getConfigContent());
    }, []);

    // ── Empty state ────────────────────────────────────────────

    if (hasConfig) {
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
                    <EmptyState
                        onScanQR={() => setCameraVisible(true)}
                        onImportUrl={() => setImportUrlVisible(true)}
                    />
                </SafeAreaView>

                <ImportUrlModal visible={importUrlVisible} onClose={handleImportUrlClose} />
                <Modal visible={cameraVisible} onRequestClose={handleCameraClose}>
                    <View style={{ flex: 1, backgroundColor: '#000' }}>
                        <CameraQR onHandleClose={handleCameraClose} />
                    </View>
                </Modal>
            </ThemedView>
        );
    }

    // ── Main UI ────────────────────────────────────────────────

    return (
        <ThemedView style={{ flex: 1, flexDirection: 'row', justifyContent: 'center' }}>
            <SafeAreaView
                style={{
                    flex: 1,
                    maxWidth: MaxContentWidth,
                    paddingHorizontal: 20,
                    paddingBottom: BottomTabInset + Spacing.two,
                }}
            >
                {connected ? (
                    /* ── Connected layout ────────────────────────── */
                    <Animated.View
                        entering={FadeIn.duration(260)}
                        style={{ flex: 1 }}
                    >
                        {/* ── Top: Hero button + speed ─────────── */}
                        <Animated.View style={[{ alignItems: 'center', paddingTop: 32 }, floatStyle]}>
                            <ConnectButton
                                connected={connected}
                                loading={loading}
                                onPress={handleToggleConnect}
                            />
                            <Animated.View
                                entering={FadeIn.duration(400).delay(180)}
                                style={{ marginTop: 16 }}
                            >
                                <SpeedRow />
                            </Animated.View>
                        </Animated.View>

                        {/* ── Flexible spacer ───────────────────── */}
                        <View style={{ flex: 1, minHeight: 32, maxHeight: 80 }} />

                        {/* ── Bottom: Node list ─────────────────── */}
                        <Animated.View
                            entering={FadeInDown.duration(320).delay(100)}
                        >
                            <View style={{
                                height: 0.5,
                                backgroundColor: theme.backgroundElement,
                                marginHorizontal: 2,
                                marginBottom: 14,
                            }} />

                            <NodeList bottomPadding={Spacing.two} />
                        </Animated.View>
                    </Animated.View>
                ) : (
                    /* ── Disconnected: centered hero ─────────────── */
                    <Animated.View
                        entering={FadeIn.duration(260)}
                        style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
                    >
                        <ConnectButton
                            connected={connected}
                            loading={loading}
                            onPress={handleToggleConnect}
                        />
                        {!loading && (
                            <Animated.View
                                entering={FadeInDown.duration(300).delay(120)}
                                exiting={FadeOut.duration(150)}
                            >
                                <ThemedText
                                    themeColor="textSecondary"
                                    style={{ fontSize: 14, fontWeight: '500', marginTop: 8, letterSpacing: 0.1 }}
                                >
                                    轻触以连接
                                </ThemedText>
                            </Animated.View>
                        )}
                    </Animated.View>
                )}
            </SafeAreaView>

            {/* ── FAB ───────────────────────────────────────── */}

            <ImportFAB
                onScanQR={() => setCameraVisible(true)}
                onImportUrl={() => setImportUrlVisible(true)}
            />


            {/* ── Modals ────────────────────────────────────── */}
            <ImportUrlModal visible={importUrlVisible} onClose={handleImportUrlClose} />
            <Modal visible={cameraVisible} onRequestClose={handleCameraClose}>
                <View style={{ flex: 1, backgroundColor: '#000' }}>
                    <CameraQR onHandleClose={handleCameraClose} />
                </View>
            </Modal>
        </ThemedView>
    );
}
