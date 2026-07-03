import { useHairlineColor } from '@/constants/ios26-palette';
import i18n from '@/constants/language';
import { Fonts } from '@/constants/theme';
import { SING_BOX_LOG_LEVELS, SingBoxLogLevel } from '@/database/kv';
import { useTheme } from '@/hooks/use-theme';
import {
    BottomSheetBackdrop,
    BottomSheetBackdropProps,
    BottomSheetModal,
    BottomSheetScrollView,
} from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { ForwardedRef, forwardRef, memo, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ─── 各级别元数据 ──────────────────────────────────────

const LEVEL_DESC_KEY: Record<SingBoxLogLevel, string> = {
    trace: 'dev_log_level_desc_trace',
    debug: 'dev_log_level_desc_debug',
    info:  'dev_log_level_desc_info',
    warn:  'dev_log_level_desc_warn',
    error: 'dev_log_level_desc_error',
    fatal: 'dev_log_level_desc_fatal',
    panic: 'dev_log_level_desc_panic',
};

/** 各级别的强调色 —— 与别处使用的语义色板保持一致。 */
const LEVEL_COLOR: Record<SingBoxLogLevel, string> = {
    trace: '#8E8E93', // systemGray
    debug: '#5AC8FA', // systemTeal
    info:  '#34C759', // systemGreen
    warn:  '#FF9500', // systemOrange
    error: '#FF3B30', // systemRed
    fatal: '#AF52DE', // systemPurple
    panic: '#AF52DE',
};

// ─── Row ─────────────────────────────────────────────────────

interface RowProps {
    level: SingBoxLogLevel;
    selected: boolean;
    isLast: boolean;
    onSelect: (level: SingBoxLogLevel) => void;
}

const LevelRow = memo(function LevelRow({ level, selected, isLast, onSelect }: RowProps) {
    const theme = useTheme();
    const hairline = useHairlineColor();
    const accent = LEVEL_COLOR[level];

    return (
        <Pressable
            onPress={() => onSelect(level)}
            accessibilityRole="button"
            accessibilityLabel={level}
            accessibilityState={{ selected }}
            style={({ pressed }) => ({
                backgroundColor: pressed ? `${theme.textSecondary}12` : 'transparent',
            })}
        >
            <View style={styles.row}>
                <View
                    style={[
                        styles.dot,
                        { backgroundColor: accent, opacity: selected ? 1 : 0.35 },
                    ]}
                />
                <View style={styles.rowText}>
                    <Text
                        style={[
                            styles.levelName,
                            {
                                color: theme.text,
                                fontFamily: Fonts?.mono,
                                fontWeight: selected ? '700' : '500',
                            },
                        ]}
                    >
                        {level}
                    </Text>
                    <Text
                        style={[
                            styles.levelDesc,
                            { color: theme.textSecondary, fontFamily: Fonts?.sans },
                        ]}
                        numberOfLines={2}
                    >
                        {i18n.t(LEVEL_DESC_KEY[level])}
                    </Text>
                </View>
                {selected ? (
                    <Ionicons name="checkmark" size={22} color="#007AFF" />
                ) : (
                    <View style={styles.checkPlaceholder} />
                )}
            </View>
            {!isLast && (
                <View
                    style={[styles.separator, { backgroundColor: hairline }]}
                />
            )}
        </Pressable>
    );
});

// ─── Backdrop ────────────────────────────────────────────────

function renderBackdrop(props: BottomSheetBackdropProps) {
    return (
        <BottomSheetBackdrop
            {...props}
            appearsOnIndex={0}
            disappearsOnIndex={-1}
            opacity={0.45}
        />
    );
}

// ─── Sheet ───────────────────────────────────────────────────

export interface LogLevelSheetProps {
    current: SingBoxLogLevel;
    onSelect: (level: SingBoxLogLevel) => void;
    onDismiss?: () => void;
}

export const LogLevelSheet = forwardRef<BottomSheetModal, LogLevelSheetProps>(
    function LogLevelSheet(
        { current, onSelect, onDismiss }: LogLevelSheetProps,
        ref: ForwardedRef<BottomSheetModal>,
    ) {
        const theme = useTheme();
        const hairline = useHairlineColor();
        const insets = useSafeAreaInsets();
        const snapPoints = useMemo(() => ['72%'], []);
        const topInset = insets.top + 8;

        return (
            <BottomSheetModal
                ref={ref}
                snapPoints={snapPoints}
                topInset={topInset}
                enablePanDownToClose
                onDismiss={onDismiss}
                backdropComponent={renderBackdrop}
                backgroundStyle={{ backgroundColor: theme.background }}
                handleIndicatorStyle={{ backgroundColor: `${theme.textSecondary}60` }}
            >
                <View style={styles.header}>
                    <Text
                        style={[
                            styles.headerEyebrow,
                            { color: theme.textSecondary, fontFamily: Fonts?.sans },
                        ]}
                    >
                        {i18n.t('dev_log_level_title').toUpperCase()}
                    </Text>
                    <Text
                        style={[
                            styles.headerTitle,
                            { color: theme.text, fontFamily: Fonts?.rounded },
                        ]}
                    >
                        {i18n.t('dev_log_level_prompt')}
                    </Text>
                    <Text
                        style={[
                            styles.headerCaption,
                            { color: theme.textSecondary, fontFamily: Fonts?.sans },
                        ]}
                    >
                        {i18n.t('dev_log_level_caption')}
                    </Text>
                </View>

                <View style={[styles.headerRule, { backgroundColor: hairline }]} />

                <BottomSheetScrollView
                    contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
                    showsVerticalScrollIndicator={false}
                >
                    {SING_BOX_LOG_LEVELS.map((lvl, idx) => (
                        <LevelRow
                            key={lvl}
                            level={lvl}
                            selected={lvl === current}
                            isLast={idx === SING_BOX_LOG_LEVELS.length - 1}
                            onSelect={onSelect}
                        />
                    ))}
                </BottomSheetScrollView>
            </BottomSheetModal>
        );
    },
);

// ─── Styles ──────────────────────────────────────────────────

const styles = StyleSheet.create({
    header: {
        paddingHorizontal: 24,
        paddingTop: 8,
        paddingBottom: 14,
        gap: 6,
    },
    headerEyebrow: {
        fontSize: 10,
        fontWeight: '700',
        letterSpacing: 1.4,
        opacity: 0.7,
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: '700',
        letterSpacing: -0.4,
    },
    headerCaption: {
        fontSize: 12,
        lineHeight: 16,
        marginTop: 2,
        letterSpacing: -0.05,
    },
    headerRule: {
        height: StyleSheet.hairlineWidth,
        marginHorizontal: 20,
        marginBottom: 4,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 20,
        gap: 14,
    },
    dot: {
        width: 10,
        height: 10,
        borderRadius: 5,
    },
    rowText: {
        flex: 1,
        gap: 2,
    },
    levelName: {
        fontSize: 16,
        letterSpacing: 0.4,
    },
    levelDesc: {
        fontSize: 12,
        lineHeight: 16,
        letterSpacing: -0.05,
    },
    checkPlaceholder: {
        width: 22,
        height: 22,
    },
    separator: {
        height: StyleSheet.hairlineWidth,
        marginLeft: 48,
    },
});
