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
                alignSelf: 'flex-start',
                backgroundColor: `${color}1F`,
                borderRadius: small ? 6 : 8,
                paddingHorizontal: small ? 7 : 9,
                paddingVertical: small ? 2 : 4,
            }}
        >
            <Text
                style={{
                    color,
                    fontSize: small ? 11 : 13,
                    fontWeight: '700',
                    fontFamily: Fonts?.rounded,
                    letterSpacing: -0.1,
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
                minWidth: 26,
                paddingHorizontal: 6,
                paddingVertical: 3,
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
                    fontWeight: '600',
                    fontFamily: Fonts?.mono,
                }}
            >
                {KIND_GLYPH[kind]}
            </Text>
        </View>
    );
}
