/**
 * Home Screen — VPN control hub.
 * Primary user tasks: connect/disconnect, select proxy node, import subscription.
 */
import { ThemedView } from '@/components/themed-view';
import CameraQR from '@/components/ui/camera-qr';
import { ConnectButton } from '@/components/ui/home/connect-button';
import { EmptyState } from '@/components/ui/home/empty-state';
import { ImportFAB } from '@/components/ui/home/import-fab';
import { ImportUrlModal } from '@/components/ui/home/import-url-modal';
import { ModeSelector } from '@/components/ui/home/mode-selector';
import { NodeList } from '@/components/ui/home/node-list';
import { SpeedRow } from '@/components/ui/home/speed-row';
import { StatusBadge } from '@/components/ui/home/status-badge';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useVpn } from '@/contexts/vpn-context';
import { getProcessedConfig } from '@/database/helper';
import { SBConfig } from '@/database/kv';
import { useTheme } from '@/hooks/use-theme';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Alert, Modal, Platform, View } from 'react-native';
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

    if (!hasConfig) {
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
                {/* ── Hero ──────────────────────────────────── */}
                <View style={{ alignItems: 'center', paddingTop: 24, paddingBottom: 28, gap: 16 }}>
                    <ConnectButton
                        connected={connected}
                        loading={loading}
                        onPress={handleToggleConnect}
                    />
                    <StatusBadge connected={connected} loading={loading} />
                    {connected && <SpeedRow />}
                </View>

                {/* ── Divider ───────────────────────────────── */}
                <View style={{ height: 0.5, backgroundColor: theme.backgroundElement, marginBottom: 20 }} />

                {/* ── Mode selector ─────────────────────────── */}
                <View style={{ marginBottom: 20 }}>
                    <ModeSelector />
                </View>

                {/* ── Node list ─────────────────────────────── */}
                <NodeList bottomPadding={Spacing.two} />
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
