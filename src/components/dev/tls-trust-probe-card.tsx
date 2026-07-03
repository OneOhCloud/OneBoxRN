import { mediumImpact } from '@/components/ui/haptics';
import { Fonts } from '@/constants/theme';
import { ProfileConfig } from '@/database/kv';
import { useTheme } from '@/hooks/use-theme';
import ExpoOneBox from '@/modules/expo-onebox';
import { getSingBoxUserAgent } from '@/utils';
import { useState } from 'react';
import { Alert, TextInput, View } from 'react-native';
import { Card } from './card';
import { Row } from './row';

// 公共 TLS 测试服务（不属于 allowlist —— 它的 fetch 永远不会回落到加速器，
// 因此原始的 primary TLS 错误会直接暴露出来）。
// 可编辑，方便 QA 指向自签名 / host 不匹配等变体。
const DEFAULT_INVALID_CERT_URL = 'https://expired.badssl.com/';

/**
 * TLS 信任探针。Android：验证 SNI/IP fetch 路径经 systemDefaultTrustManager
 * 校验证书链（信任被绕过时 row 1 会「成功」）。iOS：验证 Network.framework
 * 的 system-trust 一致性。Row 2 走正常路径：custom-DNS resolve → IP dial →
 * SNI → system trust。
 */
export function TlsTrustProbeCard() {
    const theme = useTheme();
    const [invalidCertUrl, setInvalidCertUrl] = useState(DEFAULT_INVALID_CERT_URL);
    const [busy, setBusy] = useState(false);

    const runInvalidCertProbe = async () => {
        if (busy) return;
        mediumImpact();
        setBusy(true);
        try {
            const response = await ExpoOneBox.fetchProfileConfig(invalidCertUrl, getSingBoxUserAgent());
            // 只要收到任何响应就说明 TLS 链被接受 → 信任被绕过。
            Alert.alert(
                'Invalid-cert probe: FAIL',
                `Got HTTP ${response.statusCode} from a host with an invalid certificate — trust validation is bypassed. This must never happen.`,
            );
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            Alert.alert(
                'Invalid-cert probe: PASS (as expected)',
                `Fetch rejected — chain validation is active.\n\nError: ${msg}`,
            );
        } finally {
            setBusy(false);
        }
    };

    const runValidSniProbe = async () => {
        if (busy) return;
        mediumImpact();
        const url = ProfileConfig.getConfigLink();
        if (!url) {
            Alert.alert('Valid-host probe', 'SKIPPED — no active profile URL to fetch.');
            return;
        }
        setBusy(true);
        try {
            const response = await ExpoOneBox.fetchProfileConfig(url, getSingBoxUserAgent());
            const ok = response.statusCode >= 200 && response.statusCode < 300;
            Alert.alert(
                ok ? 'Valid-host probe: PASS' : 'Valid-host probe: CHECK',
                ok
                    ? 'Fetched the active profile over the resolve-IP + SNI + system-trust path.'
                    : `Reached the host but got HTTP ${response.statusCode}.`,
            );
        } catch (e) {
            Alert.alert('Valid-host probe: FAIL', e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Card title="TLS Trust Probe">
            <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 }}>
                <TextInput
                    value={invalidCertUrl}
                    onChangeText={setInvalidCertUrl}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    placeholder={DEFAULT_INVALID_CERT_URL}
                    placeholderTextColor={theme.textSecondary}
                    style={{
                        borderRadius: 10,
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        fontSize: 13,
                        fontFamily: Fonts?.mono,
                        color: theme.text,
                        backgroundColor: theme.backgroundElement,
                    }}
                />
            </View>
            <Row
                iconName="shield-outline"
                iconColor="#FF3B30"
                label="Invalid-cert fetch"
                caption="Expect FAIL-to-connect: chain validation must reject this host."
                onPress={runInvalidCertProbe}
            />
            <Row
                iconName="shield-checkmark-outline"
                iconColor="#34C759"
                label="Valid host via DNS+SNI"
                caption="Expect OK: active profile over resolved IP with system trust."
                onPress={runValidSniProbe}
                isLast
            />
        </Card>
    );
}
