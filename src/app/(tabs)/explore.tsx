import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useVpn } from '@/contexts/vpn-context';
import { TrafficUpdateEventPayload } from '@/modules/expo-onebox/src/ExpoOneBox.types';
import { Button, Separator, Surface } from 'heroui-native';
import { useEffect, useRef } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GetVersion } from '../../modules/expo-onebox';

// ─────────────────────────────────────────────────────────────
// Info card: version + status
// ─────────────────────────────────────────────────────────────

function InfoCard({ connected }: { connected: boolean }) {
  const version = GetVersion();

  return (
    <Surface variant="secondary" className="rounded-2xl p-4 gap-2">
      <View className="flex-row justify-between items-center py-1">
        <ThemedText type="small" themeColor="textSecondary" style={styles.rowLabel}>
          内核版本
        </ThemedText>
        <ThemedText
          type="small"
          style={{ fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontWeight: '500' }}>
          {version || '—'}
        </ThemedText>
      </View>
      <Separator />
      <View className="flex-row justify-between items-center py-1">
        <ThemedText type="small" themeColor="textSecondary" style={styles.rowLabel}>
          运行状态
        </ThemedText>
        <View className="flex-row items-center gap-1">
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
    </Surface>
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
  return (
    <Surface variant="default" className="flex-1 rounded-xl p-2.5 gap-0.5" style={{ minWidth: '45%' }}>
      <ThemedText style={{ fontSize: 14, lineHeight: 20, fontWeight: '600', color: '#007AFF' }}>
        {icon}
      </ThemedText>
      <ThemedText
        numberOfLines={1}
        style={{
          fontSize: 14,
          fontWeight: '700',
          fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
        }}>
        {value}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 11, lineHeight: 14 }}>
        {label}
      </ThemedText>
    </Surface>
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
    <Surface variant="secondary" className="rounded-2xl p-4 gap-2">
      <ThemedText style={{ fontWeight: '600', fontSize: 15 }}>流量统计</ThemedText>
      {traffic ? (
        <View className="flex-row flex-wrap gap-2">
          {cells.map((c) => (
            <MetricCell key={c.label} icon={c.icon} label={c.label} value={c.value} />
          ))}
        </View>
      ) : (
        <ThemedText type="small" themeColor="textSecondary" style={styles.emptyHint}>
          代理连接后显示实时统计
        </ThemedText>
      )}
    </Surface>
  );
}

// ─────────────────────────────────────────────────────────────
// Log panel
// ─────────────────────────────────────────────────────────────

function LogPanel({ logs, onClear }: { logs: string[]; onClear: () => void }) {
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (logs.length > 0) {
      scrollRef.current?.scrollToEnd({ animated: false });
    }
  }, [logs]);

  return (
    <Surface variant="secondary" className="rounded-2xl p-4 gap-2">
      <View className="flex-row justify-between items-center">
        <ThemedText style={{ fontWeight: '600', fontSize: 15 }}>运行日志</ThemedText>
        {logs.length > 0 && (
          <Button variant="ghost" onPress={onClear} style={{ marginRight: -8 }}>
            <Button.Label>清除</Button.Label>
          </Button>
        )}
      </View>
      <Surface variant="default" className="h-[280px] rounded-xl">
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
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
                themeColor={line.includes('[ERROR]') ? undefined : 'textSecondary'}
                style={{
                  fontSize: 11,
                  lineHeight: 17,
                  fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                  ...(line.includes('[ERROR]') && { color: '#FF3B30' }),
                }}>
                {line}
              </ThemedText>
            ))
          )}
        </ScrollView>
      </Surface>
    </Surface>
  );
}

// ─────────────────────────────────────────────────────────────
// Screen
// ─────────────────────────────────────────────────────────────

export default function ExploreScreen() {
  const safeAreaInsets = useSafeAreaInsets();
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
      className="flex-1 bg-background"
      contentInset={insets}
      contentContainerStyle={[styles.contentContainer, contentPlatformStyle]}>
      <ThemedView style={[styles.inner, { maxWidth: MaxContentWidth }]}>
        <ThemedText type="subtitle" style={{ marginBottom: Spacing.two }}>
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
  rowLabel: {
    flex: 1,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  logContent: {
    padding: Spacing.two,
    gap: 2,
  },
  emptyHint: {
    textAlign: 'center',
    paddingVertical: Spacing.three,
  },
});
