import i18n from '@/constants/language';
import { useQuietChrome } from '@/constants/ios26-palette';
import { Fonts } from '@/constants/theme';
import type { RuleAction, RuleKind } from '@/database/custom-rules';
import { useTheme } from '@/hooks/use-theme';
import { Text, View } from 'react-native';

// Semantic action colors — match priority palette: reject(red) > direct(green)
// > proxy(blue). Reused by the row, composer preview and help legend.
export const ACTION_COLOR: Record<RuleAction, string> = {
    reject: '#FF3B30',
    direct: '#34C759',
    proxy: '#007AFF',
};

// Compact mono glyph standing in for each match kind in the list density.
export const KIND_GLYPH: Record<RuleKind, string> = {
    domain: '=',
    domain_suffix: '*.',
    ip_cidr: '/',
};

/** Tinted pill carrying the localized action label in its action color. */
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

/** Quiet mono glyph chip distinguishing the match kind at a glance. */
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
