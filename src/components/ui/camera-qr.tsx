import i18n from '@/constants/language';
import { BarcodeScanningResult, CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import { useState } from 'react';
import { Alert, Button, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type CameraQRProps = {
    onHandleClose: () => void;
};
export default function CameraQR(props: CameraQRProps) {
    const [facing, setFacing] = useState<CameraType>('back');
    const [permission, requestPermission] = useCameraPermissions();
    const [scanned, setScanned] = useState(false);
    const [qrData, setQrData] = useState<string | null>(null);

    if (!permission) {
        // Camera permissions are still loading.
        return <View />;
    }

    if (!permission.granted) {
        // Camera permissions are not granted yet.
        return (
            <View style={styles.container}>
                <Text style={styles.message}>{i18n.t("camera_permission")}</Text>
                <Button onPress={requestPermission} title="grant permission" />
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
