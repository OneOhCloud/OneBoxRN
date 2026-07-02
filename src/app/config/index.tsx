/**
 * Config Import Screen — downloads and displays profile configuration.
 * Reached via deep link or QR scan with base64-encoded URL in search params.
 *
 * Pure render mapping over the import-flow machine: the pipeline
 * (capture → verify → stop → download → store → start → apply) lives in
 * src/hooks/import-flow-machine.ts (node:test covered), wired by
 * src/hooks/use-import-flow.ts. Grep the Logs viewer for `flow=<id>` to
 * trace an import end-to-end.
 */
import {
    DefaultView,
    ErrorView,
    LoadingView,
    SuccessView,
} from '@/components/ui/config-import/status-views';
import i18n from '@/constants/language';
import { Fonts } from '@/constants/theme';
import { useImportFlow } from '@/hooks/use-import-flow';
import { useTheme } from '@/hooks/use-theme';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function ConfigScreen() {
    const theme = useTheme();
    const { data, apply } = useLocalSearchParams<{ data: string; apply?: string }>();
    const { phase, errorMessage } = useImportFlow({ data, apply });

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
            {/* Navigation bar — standard iOS inline title style */}
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, minHeight: 44 }}>
                <Pressable
                    onPress={() => router.back()}
                    style={({ pressed }) => ({
                        width: 44,
                        height: 44,
                        borderRadius: 22,
                        alignItems: 'center',
                        justifyContent: 'center',
                        opacity: pressed ? 0.55 : 1,
                    })}
                    hitSlop={8}
                >
                    <Ionicons name="chevron-back" size={22} color="#007AFF" />
                </Pressable>
                <Text
                    numberOfLines={1}
                    style={{
                        flex: 1,
                        textAlign: 'center',
                        fontSize: 17,
                        fontWeight: '600',
                        color: theme.text,
                        marginHorizontal: 8,
                        fontFamily: Fonts?.sans,
                    }}
                >
                    {i18n.t('import_profile')}
                </Text>
                {/* Spacer to balance back button */}
                <View style={{ width: 44 }} />
            </View>

            {/* Content states — 'applied' keeps LoadingView until the
                navigation fires (no SuccessView flash on the apply path). */}
            {phase.phase === 'error' ? (
                <ErrorView message={errorMessage ?? ''} />
            ) : phase.phase === 'success' ? (
                <SuccessView extraInfo={phase.extraInfo} />
            ) : phase.phase === 'idle' ? (
                <DefaultView />
            ) : (
                <LoadingView />
            )}
        </SafeAreaView>
    );
}
