/**
 * 配置导入屏幕 — 下载并展示配置文件。
 * 经 deep link 或扫描含 base64 编码 URL 的 QR 进入（URL 在 search params 中）。
 *
 * 纯渲染，映射 import-flow 状态机：流水线
 * （capture → verify → stop → download → store → start → apply）位于
 * src/hooks/import-flow-machine.ts，由 src/hooks/use-import-flow.ts 接线。
 * 在日志查看器里搜 `flow=<id>` 可端到端追踪一次导入。
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
            {/* 导航栏 —— 标准 iOS inline 标题样式 */}
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
                {/* 占位，用于平衡返回按钮 */}
                <View style={{ width: 44 }} />
            </View>

            {/* 内容状态 —— 'applied' 保持 LoadingView 直到导航触发
                （apply 路径上不闪现 SuccessView）。 */}
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
