/**
 * Logs Viewer — runtime log viewer with ANSI color support.
 * Accessible from Settings > Open Logs.
 */
import { lightImpact } from '@/components/ui/haptics';
import i18n from '@/constants/language';
import { Spacing } from '@/constants/theme';
import { useVpn } from '@/contexts/vpn-context';
import { useTheme } from '@/hooks/use-theme';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const MONO_FONT = Platform.OS === 'ios' ? 'Menlo' : Platform.OS === 'android' ? 'monospace' : 'Courier New';

// ─── ANSI Color Definitions ─────────────────────────────────

const ANSI_FG: Record<number, string> = {
    30: '#3a3a3c',
    31: '#FF3B30',
    32: '#34C759',
    33: '#FFCC00',
    34: '#0A84FF',
    35: '#BF5AF2',
    36: '#32ADE6',
    37: '#aeaeb2',
    90: '#636366',
    91: '#FF6961',
    92: '#30D158',
    93: '#FFD60A',
    94: '#409CFF',
    95: '#DA8FFF',
    96: '#70D7FF',
    97: '#f2f2f7',
};

const ANSI_BG: Record<number, string> = {
    40: '#3a3a3c',
    41: '#FF3B30',
    42: '#34C759',
    43: '#FFCC00',
    44: '#0A84FF',
    45: '#BF5AF2',
    46: '#32ADE6',
    47: '#aeaeb2',
    100: '#636366',
    101: '#FF6961',
    102: '#30D158',
    103: '#FFD60A',
    104: '#409CFF',
    105: '#DA8FFF',
    106: '#70D7FF',
    107: '#f2f2f7',
};

// ─── ANSI Parser ─────────────────────────────────────────────

interface AnsiSpan {
    text: string;
    color?: string;
    bgColor?: string;
    bold?: boolean;
}

interface AnsiState {
    color?: string;
    bgColor?: string;
    bold: boolean;
}

function parseAnsiLine(line: string): AnsiSpan[] {
    const spans: AnsiSpan[] = [];
    const re = /\x1b\[([0-9;]*)m/g;
    let lastIndex = 0;
    let state: AnsiState = { bold: false };
    let match: RegExpExecArray | null;

    while ((match = re.exec(line)) !== null) {
        if (match.index > lastIndex) {
            spans.push({ text: line.slice(lastIndex, match.index), ...state });
        }
        lastIndex = re.lastIndex;
        const codes = match[1] === '' ? [0] : match[1].split(';').map(Number);
        state = applyAnsiCodes(state, codes);
    }

    if (lastIndex < line.length) {
        spans.push({ text: line.slice(lastIndex), ...state });
    }
    return spans;
}

function applyAnsiCodes(prev: AnsiState, codes: number[]): AnsiState {
    const next: AnsiState = { ...prev };
    for (let i = 0; i < codes.length; i++) {
        const c = codes[i];
        if (c === 0) {
            next.color = undefined;
            next.bgColor = undefined;
            next.bold = false;
        } else if (c === 1) {
            next.bold = true;
        } else if (c === 22) {
            next.bold = false;
        } else if ((c >= 30 && c <= 37) || (c >= 90 && c <= 97)) {
            next.color = ANSI_FG[c];
        } else if (c === 39) {
            next.color = undefined;
        } else if ((c >= 40 && c <= 47) || (c >= 100 && c <= 107)) {
            next.bgColor = ANSI_BG[c];
        } else if (c === 49) {
            next.bgColor = undefined;
        }
    }
    return next;
}

// ─── ANSI Line Renderer ──────────────────────────────────────

function AnsiLine({ line, defaultColor }: { line: string; defaultColor: string }) {
    const spans = parseAnsiLine(line);

    if (spans.length === 1 && !spans[0].color && !spans[0].bgColor && !spans[0].bold) {
        return (
            <Text style={{ fontFamily: MONO_FONT, fontSize: 11, lineHeight: 16, color: defaultColor }}>
                {spans[0].text}
            </Text>
        );
    }

    return (
        <Text style={{ fontFamily: MONO_FONT, fontSize: 11, lineHeight: 16 }}>
            {spans.map((span, idx) => (
                <Text
                    key={idx}
                    style={{
                        color: span.color ?? defaultColor,
                        backgroundColor: span.bgColor,
                        fontWeight: span.bold ? '700' : '400',
                    }}
                >
                    {span.text}
                </Text>
            ))}
        </Text>
    );
}

// ─── Logs Viewer Screen ──────────────────────────────────────

export default function LogsViewerScreen() {
    const theme = useTheme();
    const safeAreaInsets = useSafeAreaInsets();
    const { logs, clearLogs } = useVpn();
    const scrollRef = useRef<ScrollView>(null);

    const defaultLogColor = theme.textSecondary ?? '#8E8E93';

    useEffect(() => {
        return () => {
            clearLogs();
        };
    }, [clearLogs]);

    return (
        <View
            style={{
                flex: 1,
                backgroundColor: theme.background,
                paddingTop: safeAreaInsets.top || Spacing.six,
                paddingBottom: safeAreaInsets.bottom + Spacing.three,
                paddingLeft: safeAreaInsets.left,
                paddingRight: safeAreaInsets.right,
            }}
        >
            {/* Header */}
            <View
                className="flex-row items-center justify-between px-2 pb-4"

            >
                <Pressable
                    onPress={() => router.back()}
                    style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 4,
                        opacity: pressed ? 0.6 : 1,
                    })}
                >
                    <Ionicons name="chevron-back" size={20} color="#007AFF" />
                    <Text style={{ color: '#007AFF', fontSize: 16, fontWeight: '400' }}>
                        {i18n.t('back')}
                    </Text>
                </Pressable>



                {logs.length > 0 && (
                    <Pressable
                        onPress={() => { lightImpact(); clearLogs(); }}
                        style={({ pressed }) => ({
                            paddingHorizontal: 12,
                            paddingVertical: 6,
                            borderRadius: 8,
                            backgroundColor: '#007AFF',
                            opacity: pressed ? 0.8 : 1,
                        })}
                    >
                        <Text style={{ color: '#fff', fontSize: 13, fontWeight: '500' }}>
                            {i18n.t('logs_clear')}
                        </Text>
                    </Pressable>
                )}
            </View>

            {/* Log panel */}
            <View
                style={{
                    flex: 1,
                    marginHorizontal: 8,
                    borderRadius: 16,
                    overflow: 'hidden',
                    borderWidth: 1.5,
                    borderColor: theme.border ?? '#E5E5EA',
                    backgroundColor: theme.cardBackground ?? '#FFFFFF',
                }}
            >
                {logs.length === 0 ? (
                    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ color: theme.textSecondary ?? '#636366', fontSize: 13 }}>
                            {i18n.t('logs_empty')}
                        </Text>
                    </View>
                ) : (
                    <ScrollView
                        ref={scrollRef}
                        contentContainerStyle={{ padding: 12 }}
                        showsVerticalScrollIndicator
                        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
                    >
                        {logs.map((item, i) => (
                            <AnsiLine key={i} line={item} defaultColor={defaultLogColor} />
                        ))}
                    </ScrollView>
                )}
            </View>
        </View>
    );
}
