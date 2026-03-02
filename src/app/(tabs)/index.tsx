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
import {
  BottomSheet,
  Button,
  Input,
  ListGroup,
  Separator,
  Surface,
  TextField,
} from 'heroui-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
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
      <Surface variant="secondary" className="w-20 h-20 rounded-full items-center justify-center mb-6">
        <ThemedText style={{ fontSize: 36, lineHeight: 44 }}>🔒</ThemedText>
      </Surface>

      <ThemedText type="subtitle" style={{ textAlign: 'center', marginBottom: Spacing.two }}>
        开始使用
      </ThemedText>
      <ThemedText themeColor="textSecondary" style={{ textAlign: 'center', lineHeight: 22, marginBottom: Spacing.five }}>
        导入订阅配置以开始使用
      </ThemedText>

      <View className="w-full gap-3">
        <Button variant="primary" onPress={onScanQR}>
          <Button.Label>扫描二维码</Button.Label>
        </Button>
        <Button variant="secondary" onPress={onImportUrl}>
          <Button.Label>导入订阅链接</Button.Label>
        </Button>
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
      <View style={[styles.statusDot, { backgroundColor: dotColor }]} />
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
      <Surface variant="secondary" className="flex-row items-center px-3 py-1.5 rounded-full gap-1">
        <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 12, fontWeight: '600' }}>↑</ThemedText>
        <ThemedText type="small" style={{ fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12 }}>{uplink}</ThemedText>
      </Surface>
      <Surface variant="secondary" className="flex-row items-center px-3 py-1.5 rounded-full gap-1">
        <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 12, fontWeight: '600' }}>↓</ThemedText>
        <ThemedText type="small" style={{ fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12 }}>{downlink}</ThemedText>
      </Surface>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Connect Button with animated halo ring
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
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (connected) {
      opacityAnim.setValue(0.28);
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.02, duration: 1100, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 1100, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      opacityAnim.setValue(0);
      pulseAnim.setValue(1);
    }
  }, [connected, opacityAnim, pulseAnim]);

  const ringColor = connected ? '#34C759' : '#8E8E93';
  const bgColor = connected ? '#34C759' : theme.backgroundElement;
  const textColor = connected ? '#ffffff' : theme.text;
  const label = loading ? '...' : connected ? '已连接' : '连接';

  return (
    <View style={styles.connectWrap}>
      {/* Outer pulse ring */}
      <Animated.View
        style={[
          styles.connectRingOuter,
          {
            borderColor: ringColor,
            transform: [{ scale: pulseAnim }],
            opacity: opacityAnim,
          },
        ]}
        pointerEvents="none"
      />
      {/* Inner ring border */}
      <View
        style={[
          styles.connectRingInner,
          { borderColor: connected ? '#34C759' : theme.backgroundElement },
        ]}
      />
      {/* Button */}
      <Pressable
        onPress={onPress}
        disabled={loading}
        style={({ pressed }) => [
          styles.connectBtn,
          { backgroundColor: bgColor, opacity: pressed || loading ? 0.7 : 1 },
        ]}>
        <ThemedText style={[styles.connectPower, { color: textColor }]}>⏻</ThemedText>
        <ThemedText style={[styles.connectLabel, { color: textColor }]}>{label}</ThemedText>
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
    <Surface variant="secondary" className="flex-row rounded-2xl p-0.5 gap-0.5">
      {options.map((opt) => {
        const active = mode === opt.value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            className={`flex-1 items-center py-2 rounded-xl ${active ? 'bg-background' : ''}`}>
            <ThemedText
              type="small"
              style={{ fontWeight: active ? '700' : '400', fontSize: 13 }}>
              {opt.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </Surface>
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
    <ListGroup.Item onPress={onSelect}>
      <ListGroup.ItemPrefix>
        <View
          style={[
            styles.nodeRadioOuter,
            { borderColor: selected ? '#007AFF' : theme.textSecondary },
          ]}>
          {selected && <View style={styles.nodeRadioInner} />}
        </View>
      </ListGroup.ItemPrefix>
      <ListGroup.ItemContent>
        <ListGroup.ItemTitle
          className={selected ? 'font-semibold text-foreground' : 'text-muted'}>
          {tag}
        </ListGroup.ItemTitle>
      </ListGroup.ItemContent>
      <ListGroup.ItemSuffix iconProps={{ size: 0 }}>
        <ThemedText
          type="small"
          style={{ color: delayColor, fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>
          {delayLabel}
        </ThemedText>
      </ListGroup.ItemSuffix>
    </ListGroup.Item>
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
    <BottomSheet isOpen={visible} onOpenChange={(open) => { if (!open) onClose(); }}>
      <BottomSheet.Portal>
        <BottomSheet.Overlay />
        <BottomSheet.Content
          enableDynamicSizing
          keyboardBehavior="fillParent"
          keyboardBlurBehavior="restore">
          <View className="px-6 pt-2 pb-10 gap-4">
            <BottomSheet.Title>导入订阅</BottomSheet.Title>
            <TextField>
              <Input
                placeholder="粘贴订阅链接 https://"
                value={url}
                onChangeText={setUrl}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="go"
                autoFocus
                onSubmitEditing={handleImport}
              />
            </TextField>
            <Button variant="primary" onPress={handleImport}>
              <Button.Label>导入</Button.Label>
            </Button>
          </View>
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  );
}

// ─────────────────────────────────────────────────────────────
// Import FAB
// ─────────────────────────────────────────────────────────────

function ImportFAB({ onScanQR, onImportUrl }: { onScanQR: () => void; onImportUrl: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.fabContainer} pointerEvents="box-none">
      {open && (
        <>
          <Pressable style={styles.fabBackdrop} onPress={() => setOpen(false)} />
          <Surface
            variant="default"
            className="rounded-2xl mb-3 overflow-hidden"
            style={styles.fabMenuShadow}>
            <Button
              variant="ghost"
              className="justify-start px-3 py-2"
              onPress={() => { setOpen(false); onScanQR(); }}
              animation={{
                opacity: { pressed: 0.7, normal: 1 },
                transition: { duration: 150 }
              }}>
              <ThemedText type="small">扫描二维码</ThemedText>
            </Button>
            <Separator />
            <Button
              variant="ghost"
              className="justify-start px-3 py-2"
              onPress={() => { setOpen(false); onImportUrl(); }}
              animation={{
                opacity: { pressed: 0.7, normal: 1 },
                transition: { duration: 150 }
              }}>
              <ThemedText type="small">导入订阅链接</ThemedText>
            </Button>
          </Surface>
        </>
      )}
      <Button
        variant="primary"
        isIconOnly
        onPress={() => setOpen((v) => !v)}
        className="w-14 h-14 rounded-full"
        feedbackVariant="scale"
        style={styles.fabShadow}>
        <Button.Label style={styles.fabIconText}>{open ? '✕' : '+'}</Button.Label>
      </Button>
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
      <ThemedView style={styles.root}>
        <SafeAreaView style={[styles.safeArea, { justifyContent: 'center' }]}>
          <EmptyState
            onScanQR={() => setCameraVisible(true)}
            onImportUrl={() => setImportUrlVisible(true)}
          />
        </SafeAreaView>
        <Modal visible={cameraVisible} animationType="slide" onRequestClose={handleCameraClose}>
          <View style={{ flex: 1, backgroundColor: 'black' }}>
            <CameraQR onHandleClose={handleCameraClose} />
          </View>
        </Modal>
        <ImportUrlModal visible={importUrlVisible} onClose={handleImportUrlClose} />
      </ThemedView>
    );
  }

  // ── Main screen ────────────────────────────────────────────
  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea}>
        {/* Status */}
        <View style={styles.headerRow}>
          <StatusBadge connected={connected} loading={loading} />
        </View>

        {/* Hero: connect button + speed */}
        <View style={styles.heroSection}>
          <ConnectButton connected={connected} loading={loading} onPress={handleToggleConnect} />
          {connected && traffic && (
            <SpeedRow
              uplink={traffic.uplinkDisplay || '0 B/s'}
              downlink={traffic.downlinkDisplay || '0 B/s'}
            />
          )}
        </View>

        {/* Mode selector */}
        <View style={styles.modeSelectorWrap}>
          <ModeSelector mode={mode} onChange={setMode} />
        </View>

        {/* Nodes section header */}
        <View style={styles.nodeSectionHeader}>
          <ThemedText type="small" themeColor="textSecondary">
            {connected ? '节点选择' : '节点（连接后可选）'}
          </ThemedText>
          {nodeList.length > 0 && (
            <View style={styles.nodeBadge}>
              <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 11 }}>
                {nodeList.length}
              </ThemedText>
            </View>
          )}
        </View>

        {/* Node list */}
        <ScrollView
          style={styles.nodeList}
          contentContainerStyle={styles.nodeListContent}
          showsVerticalScrollIndicator={false}>
          {nodeList.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary" style={{ paddingHorizontal: Spacing.one }}>
              {nodeError ? `⚠  ${nodeError}` : connected ? '加载中…' : '暂无节点'}
            </ThemedText>
          ) : (
            <ListGroup variant="default">
              {nodeList.map((node) => (
                <NodeRow
                  key={node.tag}
                  tag={node.tag}
                  delay={node.delay}
                  selected={currentNode === node.tag}
                  onSelect={() => handleNodeSelect(node.tag)}
                />
              ))}
            </ListGroup>
          )}
        </ScrollView>
      </SafeAreaView>

      {/* FAB */}
      <ImportFAB
        onScanQR={() => setCameraVisible(true)}
        onImportUrl={() => setImportUrlVisible(true)}
      />

      {/* Modals */}
      <Modal visible={cameraVisible} animationType="slide" onRequestClose={handleCameraClose}>
        <View style={{ flex: 1, backgroundColor: 'black' }}>
          <CameraQR onHandleClose={handleCameraClose} />
        </View>
      </Modal>
      <ImportUrlModal visible={importUrlVisible} onClose={handleImportUrlClose} />
    </ThemedView>
  );
}

// ─────────────────────────────────────────────────────────────
// Styles (only structural / animated values kept here)
// ─────────────────────────────────────────────────────────────

const BUTTON_SIZE = 140;
const RING_INNER = BUTTON_SIZE + 24;
const RING_OUTER = BUTTON_SIZE + 64;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.two,
  },

  // ── Header ───────────────────────────────────────────────
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Spacing.two,
    paddingBottom: Spacing.one,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  // ── Hero ─────────────────────────────────────────────────
  heroSection: {
    alignItems: 'center',
    paddingVertical: Spacing.five,
    gap: Spacing.three,
  },

  // Connect button + rings
  connectWrap: {
    width: RING_OUTER,
    height: RING_OUTER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectRingOuter: {
    position: 'absolute',
    width: RING_OUTER,
    height: RING_OUTER,
    borderRadius: RING_OUTER / 2,
    borderWidth: 2,
  },
  connectRingInner: {
    position: 'absolute',
    width: RING_INNER,
    height: RING_INNER,
    borderRadius: RING_INNER / 2,
    borderWidth: 1.5,
  },
  connectBtn: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  connectPower: {
    fontSize: 36,
    lineHeight: 44,
  },
  connectLabel: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.3,
  },

  // ── Mode selector ────────────────────────────────────────
  modeSelectorWrap: {
    marginBottom: Spacing.four,
  },

  // ── Node section ─────────────────────────────────────────
  nodeSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.two,
    paddingHorizontal: Spacing.one,
    gap: Spacing.two,
  },
  nodeBadge: {
    backgroundColor: 'rgba(128,128,128,0.15)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  nodeList: {
    flex: 1,
  },
  nodeListContent: {
    paddingBottom: Spacing.two,
  },

  // Node radio
  nodeRadioOuter: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  nodeRadioInner: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#007AFF',
  },

  // ── FAB ──────────────────────────────────────────────────
  fabContainer: {
    position: 'absolute',
    bottom: BottomTabInset + Spacing.five,
    right: Spacing.four,
    alignItems: 'flex-end',
    zIndex: 100,
  },
  fabBackdrop: {
    ...StyleSheet.absoluteFillObject,
    bottom: -999,
    top: -999,
    left: -999,
    right: -999,
  },
  fabMenuShadow: {
    minWidth: 176,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 10,
  },
  fabShadow: {
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  fabIconText: {
    color: '#fff',
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '300',
  },
});
