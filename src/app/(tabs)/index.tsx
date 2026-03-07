/**
 * Home Screen — VPN control hub.
 * Primary user tasks: connect/disconnect, select proxy node, import subscription.
 */
import { ThemedView } from '@/components/themed-view';
import CameraQR from '@/components/ui/camera-qr';
import { ConnectedLayout } from '@/components/ui/home/connected-layout';
import { DisconnectedLayout } from '@/components/ui/home/disconnected-layout';
import { EmptyState } from '@/components/ui/home/empty-state';
import { ImportFAB } from '@/components/ui/home/import-fab';
import { ImportUrlModal } from '@/components/ui/home/import-url-modal';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useHomeScreen } from '@/hooks/use-home-screen';
import { Modal, Platform, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function HomeScreen() {
    const {
        connected,
        loading,
        hasConfig,
        subInfo,
        cameraVisible,
        importUrlVisible,
        setCameraVisible,
        setImportUrlVisible,
        handleToggleConnect,
        handleCameraClose,
        handleImportUrlClose,
    } = useHomeScreen();

    if (!hasConfig && Platform.OS !== 'web') {
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
                    <ConnectedLayout
                        loading={loading}
                        subInfo={subInfo}
                        onPress={handleToggleConnect}
                    />
                ) : (
                    <DisconnectedLayout
                        loading={loading}
                        subInfo={subInfo}
                        onPress={handleToggleConnect}
                    />
                )}
            </SafeAreaView>

            <ImportFAB
                onScanQR={() => setCameraVisible(true)}
                onImportUrl={() => setImportUrlVisible(true)}
            />

            <ImportUrlModal visible={importUrlVisible} onClose={handleImportUrlClose} />
            <Modal visible={cameraVisible} onRequestClose={handleCameraClose}>
                <View style={{ flex: 1, backgroundColor: '#000' }}>
                    <CameraQR onHandleClose={handleCameraClose} />
                </View>
            </Modal>
        </ThemedView>
    );
}
