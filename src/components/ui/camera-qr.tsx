/**
 * Camera QR Scanner — full-screen camera for scanning config QR codes.
 * Handles permission flow: auto-request → manual settings → scan.
 * All styles via NativeWind className, zero StyleSheet.
 */
import { lightImpact } from '@/components/ui/haptics';
import i18n from '@/constants/language';
import { jsLog } from '@/utils/log-sink';
import { BarcodeScanningResult, CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, Text, View } from 'react-native';

const SCHEME = 'oneoh-networktools://config';

/**
 * Parse QR data into a route-compatible payload.
 * Logs the decision branch and any parse failure so a stuck import flow
 * can be traced back to the recognition step (scheme match vs. https
 * fallback vs. rejection).
 *
 * Exported so the developer-tools import-flow test panel can exercise
 * the exact recognition branch the scanner uses, without having to
 * reinvent the matching rules.
 */
export function resolveQRData(raw: string): { data: string; apply?: string } | null {
    jsLog.debug(`[QR] resolveQRData: bytes=${raw.length}, prefix=${JSON.stringify(raw.slice(0, 48))}`);
    if (raw.startsWith(SCHEME)) {
        try {
            const url = new URL(raw);
            const data = url.searchParams.get('data');
            if (data) {
                const apply = url.searchParams.get('apply') ?? undefined;
                jsLog.info(`[QR] resolveQRData: scheme match, dataBytes=${data.length}, apply=${apply ?? '(none)'}`);
                return { data, apply };
            }
            jsLog.warn('[QR] resolveQRData: scheme match but data param missing');
        } catch (e) {
            jsLog.warn(`[QR] resolveQRData: URL parse failed for scheme payload: ${(e as Error).message}`);
        }
        return null;
    }
    if (raw.startsWith('https://')) {
        const data = btoa(raw);
        jsLog.info(`[QR] resolveQRData: plain https URL, encoded bytes=${data.length}`);
        return { data };
    }
    jsLog.info('[QR] resolveQRData: unrecognized payload, neither scheme nor https');
    return null;
}

type CameraQRProps = {
    onHandleClose: () => void;
    onBeforeNavigate?: () => void;
};

export default function CameraQR({ onHandleClose, onBeforeNavigate }: CameraQRProps) {
    const [facing] = useState<CameraType>('back');
    const [permission, requestPermission] = useCameraPermissions();
    const [requestedOnce, setRequestedOnce] = useState(false);
    const scannedRef = useRef(false);

    useEffect(() => {
        if (!permission && !requestedOnce) {
            jsLog.debug('[QR] permission undefined on mount, invoking requestPermission');
            requestPermission();
            setRequestedOnce(true);
            return;
        }
        if (permission && !permission.granted && permission.canAskAgain && !requestedOnce) {
            jsLog.debug(`[QR] permission denied but askable, retry: canAskAgain=${permission.canAskAgain}`);
            requestPermission();
            setRequestedOnce(true);
        }
    }, [permission, requestPermission, requestedOnce]);

    useEffect(() => {
        if (!permission) return;
        jsLog.info(`[QR] permission state: granted=${permission.granted}, canAskAgain=${permission.canAskAgain}`);
    }, [permission]);

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
        if (scannedRef.current) {
            jsLog.debug('[QR] barcode event ignored, scannedRef already latched');
            return;
        }
        scannedRef.current = true;

        jsLog.info(`[QR] barcode captured: type=${result.type}, bytes=${result.data.length}`);

        const resolved = resolveQRData(result.data);
        if (resolved) {
            const applyParam = resolved.apply ? `&apply=${resolved.apply}` : '';
            const encodedData = encodeURIComponent(resolved.data);
            jsLog.info(`[QR] navigating to /config, apply=${resolved.apply ?? '(none)'}, encodedBytes=${encodedData.length}`);
            jsLog.debug(`[QR] pushed path: /config?data=${encodedData}${applyParam}`);

            onBeforeNavigate?.();
            onHandleClose();
            // Inline template literal preserves the typed-route pattern match
            // that the Expo Router `typedRoutes` experiment depends on —
            // hoisting the string to a local widens it to `string` and breaks
            // the overload resolution on `router.push`.
            router.push(`/config?data=${encodedData}${applyParam}`);
        } else {
            jsLog.warn('[QR] payload unrecognized, prompting user');
            Alert.alert(i18n.t('qr_unrecognized'), i18n.t('qr_invalid_content'), [
                { text: i18n.t('ok'), onPress: () => {
                    jsLog.debug('[QR] user dismissed unrecognized alert, re-arming scanner');
                    scannedRef.current = false;
                } },
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
