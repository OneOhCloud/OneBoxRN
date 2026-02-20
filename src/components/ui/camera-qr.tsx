import i18n from '@/constants/language';
import { BarcodeScanningResult, CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const SCHEME = 'oneoh-networktools://config';

function resolveQRData(raw: string): { data: string } | null {
    // 已经是 deep link 格式
    if (raw.startsWith(SCHEME)) {
        const url = new URL(raw);
        const data = url.searchParams.get('data');
        if (data) return { data };
    }
    // https 链接，转成 base64
    if (raw.startsWith('https://')) {
        const data = btoa(raw);
        return { data };
    }
    return null;
}

type CameraQRProps = {
    onHandleClose: () => void;
};
export default function CameraQR(props: CameraQRProps) {
    const [facing, setFacing] = useState<CameraType>('back');
    const [permission, requestPermission] = useCameraPermissions();
    const [requestedOnce, setRequestedOnce] = useState(false);
    const scannedRef = useRef(false);

    useEffect(() => {
        // 自动请求一次权限：初次加载或在可再次请求的情况下自动尝试
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

    if (!permission) {
        // Camera permissions are still loading.
        return <View />;
    }

    // 权限被明确拒绝且不能再次请求：提示用户手动打开系统设置
    if (!permission.granted && !permission.canAskAgain) {
        async function openSettings() {
            try {
                await Linking.openSettings();
            } catch (e) {
                Alert.alert(i18n.t('error'), i18n.t('open_settings_failed'));
            }
        }

        return (
            <View style={styles.container}>
                <Text style={styles.message}>{i18n.t("camera_permission_denied")}</Text>
                <View style={styles.buttonContainer}>
                    <TouchableOpacity style={styles.button} onPress={openSettings}>
                        <Text style={styles.text}>{i18n.t('open_settings')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.button} onPress={props.onHandleClose}>
                        <Text style={styles.text}>{i18n.t('close')}</Text>
                    </TouchableOpacity>
                </View>
            </View>
        );
    }

    // 权限未授予但可以再次请求：展示一个按钮供用户触发请求（自动请求已在 useEffect 做一次尝试）
    if (!permission.granted && permission.canAskAgain) {
        return (
            <View style={styles.container}>
                <Text style={styles.message}>{i18n.t("camera_permission")}</Text>
                <View style={styles.buttonContainer}>
                    <TouchableOpacity style={styles.button} onPress={props.onHandleClose}>
                        <Text style={styles.text}>{i18n.t('close')}</Text>
                    </TouchableOpacity>
                </View>
            </View>
        );
    }


    function toggleCameraFacing() {
        setFacing(current => (current === 'back' ? 'front' : 'back'));
    }

    function handleBarCodeScanned(result: BarcodeScanningResult) {
        if (scannedRef.current) return;
        scannedRef.current = true;

        const resolved = resolveQRData(result.data);
        if (resolved) {
            props.onHandleClose();
            router.push(`/config?data=${encodeURIComponent(resolved.data)}`);
        } else {
            Alert.alert('无法识别', '二维码内容不是有效的链接', [
                { text: '确定', onPress: () => { scannedRef.current = false; } }
            ]);
        }
    }

    return (
        <View style={styles.container}>
            <CameraView
                style={styles.camera}
                facing={facing}
                barcodeScannerSettings={{
                    barcodeTypes: ['qr'],
                }}
                onBarcodeScanned={handleBarCodeScanned}
            />
            <View style={styles.buttonContainer}>
                <TouchableOpacity style={styles.button} onPress={props.onHandleClose}>
                    <Text style={styles.text}>{i18n.t("close")}</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
    },
    message: {
        color: 'white',
        textAlign: 'center',
        paddingBottom: 10,
    },
    camera: {
        flex: 1,
    },
    buttonContainer: {
        position: 'absolute',
        bottom: 64,
        flexDirection: 'row',
        backgroundColor: 'transparent',
        width: '100%',
        paddingHorizontal: 64,
    },
    button: {
        flex: 1,
        alignItems: 'center',
    },
    text: {
        fontSize: 24,
        fontWeight: 'bold',
        color: 'white',
    },

});
