/**
 * Camera QR Scanner — full-screen camera for scanning subscription QR codes.
 * Handles permission flow: auto-request → manual settings → scan.
 * All styles via NativeWind className, zero StyleSheet.
 */
import { lightImpact } from '@/components/ui/haptics';
import i18n from '@/constants/language';
import { BarcodeScanningResult, CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, Text, View } from 'react-native';

const SCHEME = 'oneoh-networktools://config';

/** Parse QR data into a route-compatible payload */
function resolveQRData(raw: string): { data: string } | null {
    if (raw.startsWith(SCHEME)) {
        const url = new URL(raw);
        const data = url.searchParams.get('data');
        if (data) return { data };
    }
    if (raw.startsWith('https://')) {
        const data = btoa(raw);
        return { data };
    }
    return null;
}

type CameraQRProps = {
    onHandleClose: () => void;
};

export default function CameraQR({ onHandleClose }: CameraQRProps) {
    const [facing] = useState<CameraType>('back');
    const [permission, requestPermission] = useCameraPermissions();
    const [requestedOnce, setRequestedOnce] = useState(false);
    const scannedRef = useRef(false);

    useEffect(() => {
        if (!permission && !requestedOnce) {
            requestPermission();
            setRequestedOnce(true);
            return;
        }
        if (permission && !permission.granted && permission.canAskAgain && !requestedOnce) {
            requestPermission();
            setRequestedOnce(true);
        }
    }, [permission, requestPermission, requestedOnce]);

    // Loading: permissions still being checked
    if (!permission) {
        return <View className="flex-1 bg-black" />;
    }

    // Permission denied permanently — show settings prompt
    if (!permission.granted && !permission.canAskAgain) {
        async function openSettings() {
            try {
                await Linking.openSettings();
            } catch {
                Alert.alert(i18n.t('error'), i18n.t('open_settings_failed'));
            }
        }

        return (
            <View className="flex-1 bg-black justify-center items-center px-8">
                <Text className="text-white text-center mb-4 text-base leading-6">
                    {i18n.t('camera_permission_denied')}
                </Text>
                <View className="flex-row gap-4 mt-4">
                    <Pressable
                        onPress={() => { lightImpact(); openSettings(); }}
                        className="px-6 py-3 rounded-full active:opacity-70"
                        style={{ backgroundColor: '#007AFF' }}
                    >
                        <Text className="text-white text-base font-semibold">{i18n.t('open_settings')}</Text>
                    </Pressable>
                    <Pressable
                        onPress={() => { lightImpact(); onHandleClose(); }}
                        className="px-6 py-3 rounded-full active:opacity-70"
                        style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}
                    >
                        <Text className="text-white text-base font-semibold">{i18n.t('close')}</Text>
                    </Pressable>
                </View>
            </View>
        );
    }

    // Permission not yet granted but can re-ask
    if (!permission.granted && permission.canAskAgain) {
        return (
            <View className="flex-1 bg-black justify-center items-center px-8">
                <Text className="text-white text-center mb-4 text-base leading-6">
                    {i18n.t('camera_permission')}
                </Text>
                <Pressable
                    onPress={() => { lightImpact(); onHandleClose(); }}
                    className="px-6 py-3 rounded-full active:opacity-70 mt-4"
                    style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}
                >
                    <Text className="text-white text-base font-semibold">{i18n.t('close')}</Text>
                </Pressable>
            </View>
        );
    }

    // Scan handler
    function handleBarCodeScanned(result: BarcodeScanningResult) {
        if (scannedRef.current) return;
        scannedRef.current = true;

        const resolved = resolveQRData(result.data);
        if (resolved) {
            onHandleClose();
            router.push(`/config?data=${encodeURIComponent(resolved.data)}`);
        } else {
            Alert.alert('无法识别', '二维码内容不是有效的链接', [
                { text: '确定', onPress: () => { scannedRef.current = false; } },
            ]);
        }
    }

    // Camera view with scan overlay
    return (
        <View style={{ flex: 1, backgroundColor: '#000' }}>
            <CameraView
                style={{ flex: 1 }}
                facing={facing}
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={handleBarCodeScanned}
            />
            {/* Bottom controls */}
            <View style={{ position: 'absolute', bottom: 64, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', paddingHorizontal: 64 }}>
                <Pressable
                    onPress={() => { lightImpact(); onHandleClose(); }}
                    style={({ pressed }) => ({ paddingHorizontal: 32, paddingVertical: 12, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.15)', opacity: pressed ? 0.7 : 1 })}
                >
                    <Text style={{ color: '#fff', fontSize: 18, fontWeight: '600' }}>{i18n.t('close')}</Text>
                </Pressable>
            </View>
        </View>
    );
}
