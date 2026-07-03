/**
 * 相机二维码扫描 — 全屏相机，用于扫描配置二维码。
 * 处理权限流程：自动请求 → 手动跳设置 → 扫描。
 * 全部样式走 NativeWind className，不使用 StyleSheet。
 */
import { lightImpact } from '@/components/ui/haptics';
import i18n from '@/constants/language';
import { jsLog } from '@/utils/log-sink';
import { BarcodeScanningResult, CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, Text, View } from 'react-native';

import { resolveQRData } from './qr-data';

// 重新导出，供开发者工具的导入流程测试面板复用扫描器实际走的识别分支。
// parser 本体放在无依赖的 `./qr-data` 模块，可脱离设备做单元测试。
export { resolveQRData } from './qr-data';

type CameraQRProps = {
    onHandleClose: () => void;
    onBeforeNavigate?: () => void;
};

export default function CameraQR({ onHandleClose, onBeforeNavigate }: CameraQRProps) {
    const [facing] = useState<CameraType>('back');
    const [permission, requestPermission] = useCameraPermissions();
    // 从不参与渲染 — 仅用于守卫一次性的自动请求，因此该用 ref 而非 state；
    // 翻转时不希望触发重渲染。
    const requestedOnceRef = useRef(false);
    const scannedRef = useRef(false);

    useEffect(() => {
        if (requestedOnceRef.current) return;
        if (!permission) {
            jsLog.debug('[QR] permission undefined on mount, invoking requestPermission');
            requestPermission();
            requestedOnceRef.current = true;
            return;
        }
        if (!permission.granted && permission.canAskAgain) {
            jsLog.debug(`[QR] permission denied but askable, retry: canAskAgain=${permission.canAskAgain}`);
            requestPermission();
            requestedOnceRef.current = true;
        }
    }, [permission, requestPermission]);

    useEffect(() => {
        if (!permission) return;
        jsLog.info(`[QR] permission state: granted=${permission.granted}, canAskAgain=${permission.canAskAgain}`);
    }, [permission]);

    // 加载中：权限仍在检查
    if (!permission) {
        return <View className="flex-1 bg-black" />;
    }

    // 权限被永久拒绝 — 展示跳转设置的提示
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

    // 尚未授权但仍可再次询问
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

    // 扫描回调
    function handleBarCodeScanned(result: BarcodeScanningResult) {
        if (scannedRef.current) {
            jsLog.debug('[QR] barcode event ignored, scannedRef already latched');
            return;
        }
        scannedRef.current = true;

        jsLog.info(`[QR] barcode captured: type=${result.type}, bytes=${result.data.length}`);

        const resolved = resolveQRData(result.data, jsLog);
        if (resolved) {
            const applyParam = resolved.apply ? `&apply=${resolved.apply}` : '';
            const encodedData = encodeURIComponent(resolved.data);
            jsLog.info(`[QR] navigating to /config, apply=${resolved.apply ?? '(none)'}, encodedBytes=${encodedData.length}`);
            jsLog.debug(`[QR] pushed path: /config?data=${encodedData}${applyParam}`);

            onBeforeNavigate?.();
            onHandleClose();
            // 内联模板字面量保留 Expo Router `typedRoutes` 实验所依赖的类型化
            // 路由模式匹配 — 把字符串提取到局部变量会退化为 `string`，破坏
            // `router.push` 的重载解析。
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

    // 相机视图 + 扫描浮层
    return (
        <View style={{ flex: 1, backgroundColor: '#000' }}>
            <CameraView
                style={{ flex: 1 }}
                facing={facing}
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={handleBarCodeScanned}
            />
            {/* 底部控件 */}
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
