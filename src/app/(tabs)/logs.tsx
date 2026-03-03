/**
 * Logs Screen — runtime log viewer with Linux terminal ANSI color support.
 * All data sourced from the VpnContext shared state.
 */
import { ThemedText } from '@/components/themed-text';
import { lightImpact } from '@/components/ui/haptics';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useVpn } from '@/contexts/vpn-context';
import { useTheme } from '@/hooks/use-theme';
import { useEffect, useRef } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const MONO_FONT = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

// ─── ANSI Color Definitions ─────────────────────────────────
/** Standard 16-color palette mapped to iOS/Material design colors */
const ANSI_FG: Record<number, string> = {
    30: '#3a3a3c', // black
    31: '#FF3B30', // red
    32: '#34C759', // green
    33: '#FFCC00', // yellow
    34: '#0A84FF', // blue
    35: '#BF5AF2', // magenta
    36: '#32ADE6', // cyan
    37: '#aeaeb2', // white
    90: '#636366', // bright black (gray)
    91: '#FF6961', // bright red
    92: '#30D158', // bright green
    93: '#FFD60A', // bright yellow
    94: '#409CFF', // bright blue
    95: '#DA8FFF', // bright magenta
    96: '#70D7FF', // bright cyan
    97: '#f2f2f7', // bright white
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

/** Parse a single line with ANSI escape codes into styled spans */
function parseAnsiLine(line: string): AnsiSpan[] {
    const spans: AnsiSpan[] = [];
    // Matches ESC[ ... m sequences (CSI SGR)
    const re = /\x1b\[([0-9;]*)m/g;

    let lastIndex = 0;
    let state: AnsiState = { bold: false };

    let match: RegExpExecArray | null;
    while ((match = re.exec(line)) !== null) {
        // Push the text segment before this escape
        if (match.index > lastIndex) {
            spans.push({ text: line.slice(lastIndex, match.index), ...state });
        }
        lastIndex = re.lastIndex;

        // Parse the codes (e.g. "1;32" → [1, 32])
        const codes = match[1] === '' ? [0] : match[1].split(';').map(Number);
        state = applyAnsiCodes(state, codes);
    }

    // Push remaining text
    if (lastIndex < line.length) {
        spans.push({ text: line.slice(lastIndex), ...state });
    }

    return spans;
}

function applyAnsiCodes(prev: AnsiState, codes: number[]): AnsiState {
    const next: AnsiState = { ...prev };
    let i = 0;
    while (i < codes.length) {
        const c = codes[i];
        if (c === 0) {
            // Reset all
            next.color = undefined;
            next.bgColor = undefined;
            next.bold = false;
        } else if (c === 1) {
            next.bold = true;
        } else if (c === 22) {
            next.bold = false;
        } else if (c >= 30 && c <= 37) {
            next.color = ANSI_FG[c];
        } else if (c === 39) {
            next.color = undefined;
        } else if (c >= 40 && c <= 47) {
            next.bgColor = ANSI_BG[c];
        } else if (c === 49) {
            next.bgColor = undefined;
        } else if (c >= 90 && c <= 97) {
            next.color = ANSI_FG[c];
        } else if (c >= 100 && c <= 107) {
            next.bgColor = ANSI_BG[c];
        }
        i++;
    }
    return next;
}

// ─── ANSI Line Renderer ──────────────────────────────────────
/** Renders a single log line with ANSI color support */
function AnsiLine({ line, defaultColor }: { line: string; defaultColor: string }) {
    const spans = parseAnsiLine(line);

    // Fast path: no ANSI codes at all
    if (spans.length === 1 && !spans[0].color && !spans[0].bgColor && !spans[0].bold) {
        return (
            <Text
                style={{
                    fontFamily: MONO_FONT,
                    fontSize: 11,
                    lineHeight: 16,
                    color: defaultColor,
                }}
            >
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

// ─── Log Screen ──────────────────────────────────────────────
export default function LogsScreen() {
    const theme = useTheme();
    const safeAreaInsets = useSafeAreaInsets();
    const { logs, clearLogs } = useVpn();
    const scrollRef = useRef<ScrollView>(null);

    // Auto-scroll to bottom on new logs
    useEffect(() => {
        if (logs.length > 0) {
            scrollRef.current?.scrollToEnd({ animated: true });
        }
    }, [logs]);

    const insets = {
        ...safeAreaInsets,
        bottom: safeAreaInsets.bottom + BottomTabInset + Spacing.three,
    };

    const contentPlatformStyle = Platform.select({
        android: {
            paddingTop: insets.top,
            paddingLeft: insets.left,
            paddingRight: insets.right,
            paddingBottom: insets.bottom,
        },
        web: {
            paddingTop: Spacing.six,
            paddingBottom: Spacing.four,
        },
    });

    // Default text color for un-styled log text
    const defaultLogColor = theme.textSecondary ?? '#8E8E93';

    return (
        <View
            className="flex-1"
            style={{
                backgroundColor: theme.background,
                paddingTop: Platform.OS === 'web' ? Spacing.six : insets.top,
                paddingBottom: insets.bottom,
                paddingLeft: insets.left,
                paddingRight: insets.right,
            }}
        >
            {/* Page title + clear button */}
            <View className="flex-row justify-between items-center px-5 ">
                <ThemedText type="subtitle">日志</ThemedText>
                {logs.length > 0 && (
                    <Pressable
                        onPress={() => { lightImpact(); clearLogs(); }}
                        className="px-3 py-1.5 rounded-lg active:opacity-70"
                        style={{ backgroundColor: '#007AFF' }}
                    >
                        <ThemedText style={{ color: '#ffffff' }} className="text-xs font-medium">
                            清除
                        </ThemedText>
                    </Pressable>
                )}
            </View>

            {/* Terminal log panel — fills all remaining safe-area height */}
            <View
                className="h-screen-safe mx-2 border-gray-50 border-2 rounded-2xl overflow-hidden"

            >
                <ScrollView
                    ref={scrollRef}
                    className="flex-1"
                    contentContainerStyle={{ padding: 12 }}
                    showsVerticalScrollIndicator
                >
                    {logs.length === 0 ? (
                        <View className="py-10 items-center">
                            <Text style={{ color: '#636366', fontSize: 13 }}>暂无日志</Text>
                        </View>
                    ) : (
                        logs.map((line, i) => (
                            <AnsiLine
                                key={`log-${i}`}
                                line={line}
                                defaultColor={defaultLogColor}
                            />
                        ))
                    )}
                </ScrollView>
            </View>
        </View>
    );
}
