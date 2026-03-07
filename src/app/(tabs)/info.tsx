/**
 * Info Screen — system info and traffic statistics.
 * All data sourced from the VpnContext shared state.
 */
import { ThemedText } from '@/components/themed-text';
import { InfoCard } from '@/components/ui/home/info-card';
import { ModeSelector } from '@/components/ui/home/mode-selector';
import TrafficCard, { SectionLabel } from '@/components/ui/home/traffic-card';
import i18n from '@/constants/language';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useVpn } from '@/contexts/vpn-context';
import { useTheme } from '@/hooks/use-theme';
import { Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';


export default function InfoScreen() {
    const theme = useTheme();
    const safeAreaInsets = useSafeAreaInsets();

    const { connected, traffic } = useVpn();
    const insets = {
        ...safeAreaInsets,
        bottom: safeAreaInsets.bottom + BottomTabInset + Spacing.three,
    };
    return (
        <View
            className="flex-1"
            style={{
                backgroundColor: theme.background,
                paddingTop: Platform.OS === 'web' ? Spacing.six : insets.top,
                paddingLeft: insets.left,
                paddingRight: insets.right,
            }}
        >
            <ScrollView className="flex-1 " >
                <View className="flex-col  px-5 gap-8 ">
                    {/* Page title */}
                    <ThemedText type="subtitle">{i18n.t('info_title')}</ThemedText>

                    {/* Routing mode */}
                    <View>
                        <SectionLabel text={i18n.t('section_routing_mode')} />
                        <ModeSelector hideSectionLabel />
                    </View>

                    {/* System info */}
                    <InfoCard connected={connected} />

                    {/* Traffic stats */}
                    <TrafficCard traffic={traffic} />
                </View>
                <View style={{ height: insets.bottom }} />
            </ScrollView>

        </View>
    );
}
