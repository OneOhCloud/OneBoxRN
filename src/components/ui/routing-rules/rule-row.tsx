import { lightImpact } from '@/components/ui/haptics';
import { SETTINGS_ROW } from '@/components/ui/ios26/settings-row';
import { ActionBadge, KindChip } from '@/components/ui/routing-rules/rule-badges';
import i18n from '@/constants/language';
import { Fonts } from '@/constants/theme';
import type { FlatRule } from '@/database/custom-rules';
import { useTheme } from '@/hooks/use-theme';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';

interface RuleRowProps {
    rule: FlatRule;
    onEdit: () => void;
    onDelete: () => void;
}

const pressableOpacity = ({ pressed }: { pressed: boolean }) => ({
    opacity: pressed ? 0.5 : 1,
    padding: 4,
});

export function RuleRow({ rule, onEdit, onDelete }: RuleRowProps) {
    const theme = useTheme();
    return (
        <View
            style={{
                flexDirection: 'row',
                alignItems: 'center',
                minHeight: 48,
                paddingVertical: SETTINGS_ROW.paddingVertical,
                paddingHorizontal: SETTINGS_ROW.paddingHorizontal,
                gap: 10,
            }}
        >
            <ActionBadge action={rule.action} small />
            <KindChip kind={rule.kind} />
            <Text
                numberOfLines={1}
                style={{
                    flex: 1,
                    fontSize: 15,
                    fontFamily: Fonts?.mono,
                    color: theme.text,
                    letterSpacing: -0.1,
                }}
            >
                {rule.value}
            </Text>
            <Pressable
                onPress={() => {
                    lightImpact();
                    onEdit();
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={i18n.t('rule_edit_title')}
                style={pressableOpacity}
            >
                <Ionicons name="pencil" size={18} color={theme.textSecondary} />
            </Pressable>
            <Pressable
                onPress={() => {
                    lightImpact();
                    onDelete();
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={i18n.t('rule_delete')}
                style={pressableOpacity}
            >
                <Ionicons name="trash-outline" size={18} color="#FF3B30" />
            </Pressable>
        </View>
    );
}
