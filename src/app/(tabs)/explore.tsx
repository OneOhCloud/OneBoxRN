import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useVpn } from '@/contexts/vpn-context';
import { useTheme } from '@/hooks/use-theme';
import { GetVersion } from '@/modules/expo-onebox';
import { TrafficUpdateEventPayload } from '@/modules/expo-onebox/src/ExpoOneBox.types';
import { useEffect, useRef } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ─────────────────────────────────────────────────────────────
// Info card: version + status
// ─────────────────────────────────────────────────────────────

function InfoCard({ connected }: { connected: boolean }) {
  const theme = useTheme();
  const version = GetVersion();

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <View style={styles.cardRow}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.rowLabel}>
          内核版本
        </ThemedText>
        <ThemedText
          type="small"
          style={[
            styles.rowValue,
            { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
          ]}>
          {version || '—'}
        </ThemedText>
      </View>
      <View style={[styles.cardDivider, { backgroundColor: theme.background }]} />
      <View style={styles.cardRow}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.rowLabel}>
          运行状态
        </ThemedText>
        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: connected ? '#34C759' : '#8E8E93' },
            ]}
          />
          <ThemedText
            type="small"
            style={{ color: connected ? '#34C759' : '#8E8E93', fontWeight: '600' }}>
            {connected ? '运行中' : '未连接'}
          </ThemedText>
        </View>
      </View>
    </ThemedView>
  );
}

// ─────────────────────────────────────────────────────────────
// Traffic metric card
// ─────────────────────────────────────────────────────────────

function MetricCell({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: string;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.metricCell, { backgroundColor: theme.background }]}>
      <ThemedText style={styles.metricIcon}>{icon}</ThemedText>
      <ThemedText
        numberOfLines={1}
        style={[
          styles.metricValue,
          { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
        ]}>
        {value}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.metricLabel}>
        {label}
      </ThemedText>
    </View>
  );
}

function TrafficCard({ traffic }: { traffic: TrafficUpdateEventPayload | null }) {
  function fmt(n: number) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  const cells: { icon: string; label: string; value: string }[] = traffic
    ? [
      { icon: '↑', label: '上行速度', value: traffic.uplinkDisplay || fmt(traffic.uplink) + '/s' },
      { icon: '↓', label: '下行速度', value: traffic.downlinkDisplay || fmt(traffic.downlink) + '/s' },
      { icon: '▲', label: '累计上行', value: traffic.uplinkTotalDisplay || fmt(traffic.uplinkTotal) },
      { icon: '▼', label: '累计下行', value: traffic.downlinkTotalDisplay || fmt(traffic.downlinkTotal) },
      { icon: '◎', label: '内存占用', value: traffic.memoryDisplay || fmt(traffic.memory) },
      { icon: '⟳', label: 'Goroutines', value: String(traffic.goroutines) },
      { icon: '→', label: '入站连接', value: String(traffic.connectionsIn) },
      { icon: '←', label: '出站连接', value: String(traffic.connectionsOut) },
    ]
    : [];

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText style={styles.cardTitle}>流量统计</ThemedText>
      {traffic ? (
        <View style={styles.metricsGrid}>
          {cells.map((c) => (
            <MetricCell key={c.label} icon={c.icon} label={c.label} value={c.value} />
          ))}
        </View>
      ) : (
        <ThemedText type="small" themeColor="textSecondary" style={styles.emptyHint}>
          VPN 连接后显示实时统计
        </ThemedText>
      )}
    </ThemedView>
  );
}

// ─────────────────────────────────────────────────────────────
// Log panel
// ─────────────────────────────────────────────────────────────

function LogPanel({ logs, onClear }: { logs: string[]; onClear: () => void }) {
  const theme = useTheme();
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (logs.length > 0) {
      scrollRef.current?.scrollToEnd({ animated: false });
    }
  }, [logs]);

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <View style={styles.logHeader}>
        <ThemedText style={styles.cardTitle}>运行日志</ThemedText>
        {logs.length > 0 && (
          <Pressable onPress={onClear} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
            <ThemedText type="small" themeColor="textSecondary">
              清除
            </ThemedText>
          </Pressable>
        )}
      </View>
      <ScrollView
        ref={scrollRef}
        style={[styles.logScroll, { backgroundColor: theme.background }]}
        contentContainerStyle={styles.logContent}
        showsVerticalScrollIndicator
        nestedScrollEnabled>
        {logs.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.emptyHint}>
            暂无日志
          </ThemedText>
        ) : (
          logs.map((line, i) => (
            <ThemedText
              key={i}
              type="small"
              style={[
                styles.logLine,
                {
                  fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                  color: line.includes('[ERROR]') ? '#FF3B30' : theme.textSecondary,
                },
              ]}>
              {line}
            </ThemedText>
          ))
        )}
      </ScrollView>
    </ThemedView>
  );
}

// ─────────────────────────────────────────────────────────────
// Screen
// ─────────────────────────────────────────────────────────────

export default function ExploreScreen() {
  const safeAreaInsets = useSafeAreaInsets();
  const theme = useTheme();
  const { connected, traffic, logs, clearLogs } = useVpn();

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

  return (
    <ScrollView
      style={[styles.scrollView, { backgroundColor: theme.background }]}
      contentInset={insets}
      contentContainerStyle={[styles.contentContainer, contentPlatformStyle]}>
      <ThemedView style={[styles.inner, { maxWidth: MaxContentWidth }]}>
        <ThemedText type="subtitle" style={styles.pageTitle}>
          状态
        </ThemedText>

        <InfoCard connected={connected} />
        <TrafficCard traffic={traffic} />
        <LogPanel logs={logs} onClear={clearLogs} />
      </ThemedView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  inner: {
    flexGrow: 1,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.five,
    gap: Spacing.three,
  },
  pageTitle: {
    marginBottom: Spacing.two,
  },

  // ── Card ─────────────────────────────────────────────────
  card: {
    borderRadius: 16,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  cardTitle: {
    fontWeight: '600',
    fontSize: 15,
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.one,
  },
  rowLabel: {
    flex: 1,
  },
  rowValue: {
    fontWeight: '500',
  },
  cardDivider: {
    height: StyleSheet.hairlineWidth,
  },

  // ── Status ────────────────────────────────────────────────
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },

  // ── Metrics ───────────────────────────────────────────────
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  metricCell: {
    flex: 1,
    minWidth: '45%',
    borderRadius: 10,
    padding: Spacing.two + 2,
    gap: 2,
  },
  metricIcon: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    color: '#007AFF',
  },
  metricValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  metricLabel: {
    fontSize: 11,
    lineHeight: 14,
  },

  // ── Log panel ─────────────────────────────────────────────
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logScroll: {
    height: 280,
    borderRadius: 10,
  },
  logContent: {
    padding: Spacing.two,
    gap: 2,
  },
  logLine: {
    fontSize: 11,
    lineHeight: 17,
  },

  emptyHint: {
    textAlign: 'center',
    paddingVertical: Spacing.three,
  },
});
