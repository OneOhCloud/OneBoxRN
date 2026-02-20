import i18n from '@/constants/language';
import { BarcodeScanningResult, CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useState } from 'react';
import { Alert, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type CameraQRProps = {
    onHandleClose: () => void;
};
export default function CameraQR(props: CameraQRProps) {
    const [facing, setFacing] = useState<CameraType>('back');
    const [permission, requestPermission] = useCameraPermissions();
    const [requestedOnce, setRequestedOnce] = useState(false);
    const [scanned, setScanned] = useState(false);
    const [qrData, setQrData] = useState<string | null>(null);

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
    console.log('Camera permission status:', permission);

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
                    <TouchableOpacity style={styles.button} onPress={requestPermission}>
                        <Text style={styles.text}>{i18n.t('grant_permission')}</Text>
                    </TouchableOpacity>
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
        if (scanned) return;
        setScanned(true);
        setQrData(result.data);
        Alert.alert('二维码内容', result.data, [
            { text: '确定', onPress: () => setScanned(false) }
        ]);
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
            {qrData && (
                <View style={styles.qrResult}>
                    <Text style={styles.qrText}>扫描结果: {qrData}</Text>
                </View>
            )}
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
    qrResult: {
        position: 'absolute',
        top: 60,
        left: 0,
        right: 0,
        backgroundColor: 'rgba(0,0,0,0.7)',
        padding: 16,
        marginHorizontal: 16,
        borderRadius: 8,
        alignItems: 'center',
    },
    qrText: {
        color: 'white',
        fontSize: 18,
    },
});
