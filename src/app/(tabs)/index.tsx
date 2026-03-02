import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import CameraQR from '@/components/ui/camera-qr';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useVpn } from '@/contexts/vpn-context';
import { getProcessedConfig } from '@/database/helper';
import { SBConfig } from '@/database/kv';
import { configType } from '@/definition';
import { useTheme } from '@/hooks/use-theme';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  CheckVpnPermission,
  GetProxyNodes,
  RequestVpnPermission,
  SelectProxyNode,
  Start,
  Stop,
  VPN_STATUS
} from '../../modules/expo-onebox';

// ─────────────────────────────────────────────────────────────
// Empty State
// ─────────────────────────────────────────────────────────────

function EmptyState({ onScanQR, onImportUrl }: { onScanQR: () => void; onImportUrl: () => void }) {
  return (
    <View className="flex-1 items-center justify-center px-8">
      <View className="w-20 h-20 rounded-full items-center justify-center mb-6 bg-gray-100">
        <ThemedText className="text-4xl leading-11">🔒</ThemedText>
      </View>

      <ThemedText type="subtitle" className="text-center mb-2">
        开始使用
      </ThemedText>
      <ThemedText themeColor="textSecondary" className="text-center leading-6 mb-5">
        导入订阅配置以开始使用
      </ThemedText>

      <View className="w-full gap-3">
        <Pressable
          onPress={onScanQR}
          className="bg-blue-500 py-3 rounded-xl active:bg-blue-600"
        >
          <ThemedText className="text-white text-center font-semibold">
            扫描二维码
          </ThemedText>
        </Pressable>
        <Pressable
          onPress={onImportUrl}
          className="bg-gray-100 py-3 rounded-xl active:opacity-80"
        >
          <ThemedText className="text-center font-semibold">
            导入订阅链接
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Status badge
// ─────────────────────────────────────────────────────────────

function StatusBadge({ connected, loading }: { connected: boolean; loading: boolean }) {
  const dotColor = loading ? '#FF9F0A' : connected ? '#34C759' : '#8E8E93';
  const label = loading ? '处理中' : connected ? '已连接' : '未连接';
  return (
    <View className="flex-row items-center gap-1.5">
      <View className="w-2 h-2 rounded-full" style={{ backgroundColor: dotColor }} />
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Speed row (shown when connected)
// ─────────────────────────────────────────────────────────────

function SpeedRow({ uplink, downlink }: { uplink: string; downlink: string }) {
  return (
    <View className="flex-row gap-2">
      <View className="flex-row items-center px-3 py-1.5 rounded-full gap-1 bg-backgroundElement">
        <ThemedText type="small" themeColor="textSecondary" className="text-xs font-semibold">↑</ThemedText>
        <ThemedText type="small" className="text-xs" style={{ fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>{uplink}</ThemedText>
      </View>
      <View className="flex-row items-center px-3 py-1.5 rounded-full gap-1 bg-backgroundElement">
        <ThemedText type="small" themeColor="textSecondary" className="text-xs font-semibold">↓</ThemedText>
        <ThemedText type="small" className="text-xs" style={{ fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>{downlink}</ThemedText>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Connect Button
// ─────────────────────────────────────────────────────────────

function ConnectButton({
  connected,
  loading,
  onPress,
}: {
  connected: boolean;
  loading: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  const ringColor = connected ? '#34C759' : '#8E8E93';
  const bgColor = connected ? '#34C759' : theme.backgroundElement;
  const textColor = connected ? '#ffffff' : theme.text;
  const label = loading ? '...' : connected ? '已连接' : '连接';

  return (
    <View className="w-56 h-56 items-center justify-center">
      {/* Outer ring */}
      <View
        className="absolute w-56 h-56 rounded-full border-2"
        style={{
          borderColor: ringColor,
          opacity: connected ? 0.28 : 0,
        }}
        pointerEvents="none"
      />
      {/* Inner ring border */}
      <View
        className="absolute w-44 h-44 rounded-full border border-opacity-75"
        style={{ borderColor: connected ? '#34C759' : theme.backgroundElement }}
      />
      {/* Button */}
      <Pressable
        onPress={onPress}
        disabled={loading}
        className="w-36 h-36 rounded-full items-center justify-center"
        style={({ pressed }) => ({
          backgroundColor: bgColor,
          opacity: pressed || loading ? 0.7 : 1,
        })}>
        <ThemedText className="text-4xl leading-11" style={{ color: textColor }}>⏻</ThemedText>
        <ThemedText className="text-sm font-semibold tracking-wide" style={{ color: textColor }}>{label}</ThemedText>
      </Pressable>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Mode selector (segment control)
// ─────────────────────────────────────────────────────────────

function ModeSelector({
  mode,
  onChange,
}: {
  mode: configType;
  onChange: (m: configType) => void;
}) {
  const options: { label: string; value: configType }[] = [
    { label: '规则路由', value: 'tun-rules' },
    { label: '全局代理', value: 'tun-global' },
  ];

  return (
    <View className="flex-row rounded-2xl p-0.5 gap-0.5 bg-gray-100">
      {options.map((opt) => {
        const active = mode === opt.value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            className={`flex-1 items-center py-2 rounded-xl ${active ? 'bg-white' : ''}`}>
            <ThemedText
              type="small"
              className="text-sm"
              style={{ fontWeight: active ? '700' : '400' }}>
              {opt.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Node row
// ─────────────────────────────────────────────────────────────

function NodeRow({
  tag,
  delay,
  selected,
  onSelect,
}: {
  tag: string;
  delay: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const theme = useTheme();

  const delayLabel = delay === 0 ? '—' : `${delay} ms`;
  const delayColor =
    delay === 0
      ? theme.textSecondary
      : delay < 200
        ? '#34C759'
        : delay < 500
          ? '#FF9F0A'
          : '#FF3B30';

  return (
    <Pressable
      onPress={onSelect}
      className="flex-row items-center px-4 py-3 gap-3 active:bg-gray-50"
    >
      <View
        className="w-5 h-5 rounded-full border-2 items-center justify-center shrink-0"
        style={{ borderColor: selected ? '#007AFF' : theme.textSecondary }}>
        {selected && <View className="w-2 h-2 rounded-full bg-blue-500" />}
      </View>

      <View className="flex-1">
        <ThemedText className={selected ? 'font-semibold' : 'text-gray-600'}>
          {tag}
        </ThemedText>
      </View>

      <ThemedText
        type="small"
        className="text-xs"
        style={{ color: delayColor, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>
        {delayLabel}
      </ThemedText>
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────
// Import URL bottom sheet
// ─────────────────────────────────────────────────────────────

function ImportUrlModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [url, setUrl] = useState('');

  function handleImport() {
    const trimmed = url.trim();
    if (!trimmed.startsWith('https://')) {
      Alert.alert('链接无效', '请输入以 https:// 开头的订阅链接');
      return;
    }
    onClose();
    setUrl('');
    router.push(`/config?data=${encodeURIComponent(btoa(trimmed))}`);
  }

  return (
    <Modal
      visible={visible}
      onRequestClose={onClose}
      animationType="slide"
      presentationStyle="pageSheet"
    >
      <View className="flex-1 bg-white">
        <View className="pt-4 pb-6 px-4 border-b border-gray-200">
          <View className="flex-row justify-between items-center">
            <ThemedText type="subtitle" className="text-lg font-semibold">
              导入订阅
            </ThemedText>
            <Pressable onPress={onClose} className="px-2 py-1">
              <ThemedText className="text-blue-500 font-medium">取消</ThemedText>
            </Pressable>
          </View>
        </View>

        <View className="flex-1 p-4 gap-4">
          <View className="gap-3">
            <TextInput
              placeholder="粘贴订阅链接 https://"
              value={url}
              onChangeText={setUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              autoFocus
              onSubmitEditing={handleImport}
              className="border border-gray-300 rounded-xl px-4 py-3"
              placeholderTextColor="#8E8E93"
              style={{ fontSize: 16, backgroundColor: '#f5f5f5' }}
            />
          </View>

          <Pressable
            onPress={handleImport}
            className="bg-blue-500 py-3 rounded-xl active:bg-blue-600"
          >
            <ThemedText className="text-white text-center font-semibold">
              导入
            </ThemedText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
// Import FAB
// ─────────────────────────────────────────────────────────────

function ImportFAB({ onScanQR, onImportUrl }: { onScanQR: () => void; onImportUrl: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <View className="absolute bottom-24 right-4 items-end z-50" pointerEvents="box-none">
      {open && (
        <>
          <Pressable className="absolute -inset-x-96 -inset-y-96" onPress={() => setOpen(false)} />
          <View className="rounded-2xl mb-3 overflow-hidden shadow-lg bg-white">
            <Pressable
              onPress={() => { setOpen(false); onScanQR(); }}
              className="justify-start px-3 py-2 active:bg-backgroundElement/80"
            >
              <ThemedText type="small">扫描二维码</ThemedText>
            </Pressable>
            <View className="h-px bg-gray-200" />
            <Pressable
              onPress={() => { setOpen(false); onImportUrl(); }}
              className="justify-start px-3 py-2 active:bg-backgroundElement/80"
            >
              <ThemedText type="small">导入订阅链接</ThemedText>
            </Pressable>
          </View>
        </>
      )}
      <Pressable
        onPress={() => setOpen((v) => !v)}
        className="w-14 h-14 rounded-full shadow-lg bg-blue-500 items-center justify-center active:bg-blue-600"
      >
        <ThemedText className="text-white text-2xl leading-7 font-light">
          {open ? '✕' : '+'}
        </ThemedText>
      </Pressable>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Home Screen
// ─────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const { connected, status, mode, setMode, traffic } = useVpn();
  const [localLoading, setLocalLoading] = useState(false);
  const loading = localLoading || status === VPN_STATUS.STARTING || status === VPN_STATUS.STOPPING;
  const [hasConfig, setHasConfig] = useState<boolean>(() => !!SBConfig.getConfigContent());
  const [cameraVisible, setCameraVisible] = useState(false);
  const [importUrlVisible, setImportUrlVisible] = useState(false);
  const [nodeList, setNodeList] = useState<{ tag: string; delay: number }[]>([]);
  const [currentNode, setCurrentNode] = useState<string>('');
  const [nodeError, setNodeError] = useState<string | null>(null);

  const isMounted = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (isMounted.current) {
        setHasConfig(!!SBConfig.getConfigContent());
      } else {
        isMounted.current = true;
      }
    }, [])
  );

  // ── Node polling (when connected) ──────────────────────────
  useEffect(() => {
    if (!connected) {
      setNodeList([]);
      setCurrentNode('');
      setNodeError(null);
      return;
    }
    let cancelled = false;
    let failCount = 0;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const fetchNodes = async () => {
      try {
        const res = await GetProxyNodes();
        const all = res.all ?? [];
        const now = res.now ?? '';
        if (!cancelled) {
          failCount = 0;
          setNodeList(all);
          setCurrentNode(now);
          setNodeError(null);
        }
      } catch (e: any) {
        if (!cancelled) {
          failCount += 1;
          console.warn('[NodePoll] error', failCount, e?.message);
          if (failCount >= 3) {
            setNodeError(e?.message ?? '无法获取节点列表');
          }
        }
      }
    };

    const startTimer = setTimeout(() => {
      if (cancelled) return;
      fetchNodes();
      intervalId = setInterval(fetchNodes, 2000);
    }, 2000);

    return () => {
      cancelled = true;
      clearTimeout(startTimer);
      if (intervalId !== null) clearInterval(intervalId);
    };
  }, [connected]);

  const handleNodeSelect = useCallback(async (node: string) => {
    try {
      await SelectProxyNode(node);
      setCurrentNode(node);
    } catch (e: any) {
      Alert.alert('切换节点失败', e?.message ?? '请求失败');
    }
  }, []);

  const handleToggleConnect = useCallback(async () => {
    if (loading) return;
    setLocalLoading(true);
    try {
      if (connected) {
        await Stop();
      } else {
        if (Platform.OS === 'android') {
          const hasPermission = await CheckVpnPermission();
          if (!hasPermission) {
            const granted = await RequestVpnPermission();
            if (!granted) {
              Alert.alert('权限不足', '需要 VPN 权限才能连接');
              return;
            }
          }
        }
        const config = await getProcessedConfig();
        await Start(config);
      }
    } catch (e: any) {
      Alert.alert('错误', e?.message ?? '操作失败');
    } finally {
      setLocalLoading(false);
    }
  }, [connected, loading]);

  const handleCameraClose = useCallback(() => {
    setCameraVisible(false);
    setHasConfig(!!SBConfig.getConfigContent());
  }, []);

  const handleImportUrlClose = useCallback(() => {
    setImportUrlVisible(false);
    setHasConfig(!!SBConfig.getConfigContent());
  }, []);

  // ── Empty state ────────────────────────────────────────────
  if (!hasConfig) {
    return (
      <ThemedView className="flex-1 flex-row justify-center">
        <SafeAreaView className="flex-1 px-4 pb-8" style={{ maxWidth: MaxContentWidth, paddingBottom: BottomTabInset + Spacing.two, justifyContent: 'center' }}>
          <EmptyState
            onScanQR={() => setCameraVisible(true)}
            onImportUrl={() => setImportUrlVisible(true)}
          />
        </SafeAreaView>
        <Modal visible={cameraVisible} onRequestClose={handleCameraClose}>
          <View className="flex-1 bg-black">
            <CameraQR onHandleClose={handleCameraClose} />
          </View>
        </Modal>
        <ImportUrlModal visible={importUrlVisible} onClose={handleImportUrlClose} />
      </ThemedView>
    );
  }

  // ── Main screen ────────────────────────────────────────────
  return (
    <ThemedView className="flex-1 flex-row justify-center">
      <SafeAreaView className="flex-1 px-4 pb-8" style={{ maxWidth: MaxContentWidth, paddingBottom: BottomTabInset + Spacing.two }}>
        {/* Status */}
        <View className="flex-row items-center py-2">
          <StatusBadge connected={connected} loading={loading} />

        </View>

        {/* Hero: connect button + speed */}
        <View className="items-center py-5 gap-3">
          <ConnectButton connected={connected} loading={loading} onPress={handleToggleConnect} />
          {connected && traffic && (
            <SpeedRow
              uplink={traffic.uplinkDisplay || '0 B/s'}
              downlink={traffic.downlinkDisplay || '0 B/s'}
            />
          )}
        </View>

        {/* Mode selector */}
        <View className="mb-4">
          <ModeSelector mode={mode} onChange={setMode} />
        </View>

        {/* Nodes section header */}
        <View className="flex-row items-center mb-2 px-1 gap-2">
          <ThemedText type="small" themeColor="textSecondary">
            {connected ? '节点选择' : '节点（连接后可选）'}
          </ThemedText>
          {nodeList.length > 0 && (
            <View className="bg-gray-400 bg-opacity-15 rounded-lg px-2 py-0.5">
              <ThemedText type="small" themeColor="textSecondary" className="text-xs">
                {nodeList.length}
              </ThemedText>
            </View>
          )}
        </View>

        {/* Node list */}
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: Spacing.two }}
          showsVerticalScrollIndicator={false}>
          {nodeList.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary" className="px-1">
              {nodeError ? `⚠  ${nodeError}` : connected ? '加载中…' : '暂无节点'}
            </ThemedText>
          ) : (
            <View className="bg-gray-100 rounded-xl overflow-hidden">
              {nodeList.map((node) => (
                <NodeRow
                  key={node.tag}
                  tag={node.tag}
                  delay={node.delay}
                  selected={currentNode === node.tag}
                  onSelect={() => handleNodeSelect(node.tag)}
                />
              ))}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>

      {/* FAB */}
      <ImportFAB
        onScanQR={() => setCameraVisible(true)}
        onImportUrl={() => setImportUrlVisible(true)}
      />

      {/* Modals */}
      <Modal visible={cameraVisible} onRequestClose={handleCameraClose}>
        <View className="flex-1 bg-black">
          <CameraQR onHandleClose={handleCameraClose} />
        </View>
      </Modal>
      <ImportUrlModal visible={importUrlVisible} onClose={handleImportUrlClose} />
    </ThemedView>
  );
}

// ─────────────────────────────────────────────────────────────
// No more styles - using tailwindcss!
// ─────────────────────────────────────────────────────────────
