import i18n from '@/constants/language';
import { useQuietChrome } from '@/constants/ios26-palette';
import { Fonts } from '@/constants/theme';
import type { RuleAction, RuleKind } from '@/database/custom-rules';
import { useTheme } from '@/hooks/use-theme';
import { Text, View } from 'react-native';

// 语义化的 action 配色 — 对应优先级色板：reject(红) > direct(绿) > proxy(蓝)。
// 被 row、composer 预览与帮助图例复用。
export const ACTION_COLOR: Record<RuleAction, string> = {
    reject: '#FF3B30',
    direct: '#34C759',
    proxy: '#007AFF',
};

// 紧凑的等宽字形，在密集列表中代表各 match kind。
export const KIND_GLYPH: Record<RuleKind, string> = {
    domain: '=',
    domain_suffix: '*.',
    ip_cidr: '/',
};

/** 带色药丸，用 action 配色承载本地化的 action 标签。 */
export function ActionBadge({ action, small }: { action: RuleAction; small?: boolean }) {
    const color = ACTION_COLOR[action];
    return (
        <View
            style={{
                alignSelf: 'center',
                minHeight: small ? 28 : 32,
                backgroundColor: `${color}1F`,
                borderRadius: small ? 6 : 8,
                paddingHorizontal: small ? 8 : 10,
                alignItems: 'center',
                justifyContent: 'center',
            }}
        >
            <Text
                style={{
                    color,
                    fontSize: small ? 12 : 13,
                    lineHeight: small ? 16 : 18,
                    fontWeight: '700',
                    fontFamily: Fonts?.rounded,
                    letterSpacing: -0.1,
                    includeFontPadding: false,
                    textAlignVertical: 'center',
                }}
            >
                {i18n.t(`rule_action_${action}`)}
            </Text>
        </View>
    );
}

/** 安静的等宽字形 chip，一眼区分 match kind。 */
export function KindChip({ kind }: { kind: RuleKind }) {
    const theme = useTheme();
    const chrome = useQuietChrome();
    return (
        <View
            style={{
                minWidth: 32,
                height: 28,
                paddingHorizontal: 7,
                borderRadius: 6,
                backgroundColor: chrome,
                alignItems: 'center',
                justifyContent: 'center',
            }}
        >
            <Text
                style={{
                    color: theme.textSecondary,
                    fontSize: 13,
                    lineHeight: 16,
                    fontWeight: '600',
                    fontFamily: Fonts?.mono,
                    includeFontPadding: false,
                    textAlignVertical: 'center',
                }}
            >
                {KIND_GLYPH[kind]}
            </Text>
        </View>
    );
}
