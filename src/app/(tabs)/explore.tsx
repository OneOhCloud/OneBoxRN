import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useVpn } from '@/contexts/vpn-context';
import { TrafficUpdateEventPayload } from '@/modules/expo-onebox/src/ExpoOneBox.types';
import { Button, Separator, Surface } from 'heroui-native';
import { useEffect, useRef } from 'react';
import { Platform, ScrollView, View } from 'react-native';
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
        <ThemedText type="small" themeColor="textSecondary" className="text-xs font-medium">
          内核版本
        </ThemedText>
        <ThemedText
          type="small"
          className="font-medium"
          style={{ fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>
          {version || '—'}
        </ThemedText>
      </View>
      <Separator />
      <View className="flex-row justify-between items-center py-1">
        <ThemedText type="small" themeColor="textSecondary" className="text-xs font-medium">
          运行状态
        </ThemedText>
        <View className="flex-row items-center gap-1">
          <View
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: connected ? '#34C759' : '#8E8E93' }}
          />
          <ThemedText
            type="small"
            className="font-semibold"
            style={{ color: connected ? '#34C759' : '#8E8E93' }}>
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
      <ThemedText className="text-sm leading-5 font-semibold text-blue-500">
        {icon}
      </ThemedText>
      <ThemedText
        numberOfLines={1}
        className="text-sm font-bold"
        style={{
          fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
        }}>
        {value}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" className="text-xs leading-3">
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
      <ThemedText className="font-semibold text-base">流量统计</ThemedText>
      {traffic ? (
        <View className="flex-row flex-wrap gap-2">
          {cells.map((c) => (
            <MetricCell key={c.label} icon={c.icon} label={c.label} value={c.value} />
          ))}
        </View>
      ) : (
        <ThemedText type="small" themeColor="textSecondary" >
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
      scrollRef.current?.scrollToEnd();
    }
  }, [logs]);

  return (
    <Surface variant="secondary" className="rounded-2xl p-4 gap-2">
      <View className="flex-row justify-between items-center">
        <ThemedText className="font-semibold text-base">运行日志</ThemedText>
        {logs.length > 0 && (
          <Button variant="ghost" onPress={onClear} className="-mr-2">
            <Button.Label>清除</Button.Label>
          </Button>
        )}
      </View>
      <Surface variant="default" className="h-[280px] rounded-xl">
        <ScrollView
          ref={scrollRef}
          className="flex-1"
          contentContainerStyle={{ padding: 8 }}
          showsVerticalScrollIndicator
          nestedScrollEnabled>
          {logs.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary" className="text-center py-8">
              暂无日志
            </ThemedText>
          ) : (
            logs.map((line, i) => (
              <ThemedText
                key={i}
                type="small"
                themeColor={line.includes('[ERROR]') ? undefined : 'textSecondary'}
                className="text-xs leading-4"
                style={{
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
      contentContainerStyle={{
        flexDirection: 'row',
        justifyContent: 'center',
        ...contentPlatformStyle
      }}>
      <View
        className="flex-grow px-4 pt-5 gap-3"
        style={{ maxWidth: MaxContentWidth }}>
        <ThemedText type="subtitle" className="mb-2">
          状态
        </ThemedText>

        <InfoCard connected={connected} />
        <TrafficCard traffic={traffic} />
        <LogPanel logs={logs} onClear={clearLogs} />
      </View>
    </ScrollView>
  );
}

// ─────────────────────────────────────────────────────────────
// No more styles - using tailwindcss!
// ─────────────────────────────────────────────────────────────
