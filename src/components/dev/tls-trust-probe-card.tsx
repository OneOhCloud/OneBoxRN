import { mediumImpact } from '@/components/ui/haptics';
import { Fonts } from '@/constants/theme';
import { SBConfig } from '@/database/kv';
import { useTheme } from '@/hooks/use-theme';
import ExpoOneBox from '@/modules/expo-onebox';
import { getSingBoxUserAgent } from '@/utils';
import { useState } from 'react';
import { Alert, TextInput, View } from 'react-native';
import { Card } from './card';
import { Row } from './row';

// Public TLS test service (NOT an allowlist member — its fetch can never
// fall back to the accelerator, so the raw primary TLS error surfaces).
// Editable so QA can point at self-signed / wrong-host variants.
const DEFAULT_INVALID_CERT_URL = 'https://expired.badssl.com/';

/**
 * F-03 probe. Android: verifies the SNI/IP fetch path validates chains via
 * systemDefaultTrustManager (a trust bypass would make row 1 "succeed").
 * iOS: verifies Network.framework system-trust parity. Row 2 exercises the
 * happy path: custom-DNS resolve → IP dial → SNI → system trust.
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
            // Any response at all means the TLS chain was accepted → bypass.
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
        const url = SBConfig.getConfigLink();
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
