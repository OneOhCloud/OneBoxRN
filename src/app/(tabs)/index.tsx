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
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
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
  const theme = useTheme();

  return (
    <View style={styles.emptyRoot}>
      {/* Icon */}
      <View style={[styles.emptyIconWrap, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText style={styles.emptyIcon}>🔒</ThemedText>
      </View>

      <ThemedText type="subtitle" style={styles.emptyTitle}>
        开始使用
      </ThemedText>
      <ThemedText themeColor="textSecondary" style={styles.emptySubtitle}>
        导入订阅配置以开始使用
      </ThemedText>

      <View style={styles.emptyActions}>
        <Pressable
          onPress={onScanQR}
          style={({ pressed }) => [
            styles.emptyBtn,
            styles.emptyBtnPrimary,
            { opacity: pressed ? 0.8 : 1 },
          ]}>
          <ThemedText style={styles.emptyBtnPrimaryText}>扫描二维码</ThemedText>
        </Pressable>

        <Pressable
          onPress={onImportUrl}
          style={({ pressed }) => [
            styles.emptyBtn,
            { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.8 : 1 },
          ]}>
          <ThemedText style={{ fontWeight: '600', fontSize: 15 }}>导入订阅链接</ThemedText>
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
    <View style={styles.statusBadge}>
      <View style={[styles.statusDot, { backgroundColor: dotColor }]} />
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Speed row (shown when connected)
// ─────────────────────────────────────────────────────────────

function SpeedRow({ uplink, downlink }: { uplink: string; downlink: string }) {
  const theme = useTheme();
  return (
    <View style={styles.speedRow}>
      <View style={[styles.speedPill, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.speedArrow}>↑</ThemedText>
        <ThemedText type="small" style={styles.speedValue}>{uplink}</ThemedText>
      </View>
      <View style={[styles.speedPill, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.speedArrow}>↓</ThemedText>
        <ThemedText type="small" style={styles.speedValue}>{downlink}</ThemedText>
      </View>
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
// Mode selector
// ─────────────────────────────────────────────────────────────

function ModeSelector({
  mode,
  onChange,
}: {
  mode: configType;
  onChange: (m: configType) => void;
}) {
  const theme = useTheme();
  const options: { label: string; value: configType }[] = [
    { label: '规则路由', value: 'tun-rules' },
    { label: '全局代理', value: 'tun-global' },
  ];

  return (
    <View style={[styles.modeSel, { backgroundColor: theme.backgroundElement }]}>
      {options.map((opt) => {
        const active = mode === opt.value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={[styles.modeOpt, active && { backgroundColor: theme.background }]}>
            <ThemedText
              type="small"
              style={{ fontWeight: active ? '700' : '400', fontSize: 13 }}>
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

  // Format delay: 0 means untested
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
      style={({ pressed }) => [
        styles.nodeRow,
        {
          backgroundColor: selected ? theme.backgroundSelected : theme.backgroundElement,
          opacity: pressed ? 0.7 : 1,
        },
      ]}>
      {/* Radio indicator */}
      <View
        style={[
          styles.nodeRadioOuter,
          { borderColor: selected ? '#007AFF' : theme.textSecondary },
        ]}>
        {selected && <View style={styles.nodeRadioInner} />}
      </View>
      <ThemedText
        type="small"
        numberOfLines={1}
        style={[
          styles.nodeName,
          {
            fontWeight: selected ? '600' : '400',
            color: selected ? theme.text : theme.textSecondary,
          },
        ]}>
        {tag}
      </ThemedText>
      <ThemedText
        type="small"
        style={[styles.nodeDelay, { color: delayColor }]}>
        {delayLabel}
      </ThemedText>
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────
// Import URL bottom sheet modal
// ─────────────────────────────────────────────────────────────

function ImportUrlModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme();
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
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalSheetWrapper}>
          <Pressable
            style={[styles.modalSheet, { backgroundColor: theme.background }]}
            onPress={(e) => e.stopPropagation()}>
            <View style={[styles.modalHandle, { backgroundColor: theme.backgroundElement }]} />
            <ThemedText type="subtitle" style={{ marginBottom: Spacing.three }}>
              导入订阅
            </ThemedText>
            <TextInput
              style={[styles.urlInput, { backgroundColor: theme.backgroundElement, color: theme.text }]}
              placeholder="粘贴订阅链接 https://"
              placeholderTextColor={theme.textSecondary}
              value={url}
              onChangeText={setUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              autoFocus
              onSubmitEditing={handleImport}
            />
            <Pressable
              onPress={handleImport}
              style={({ pressed }) => [
                styles.primaryBtn,
                { opacity: pressed ? 0.8 : 1, marginTop: Spacing.two },
              ]}>
              <ThemedText style={styles.primaryBtnText}>导入</ThemedText>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
// Import FAB
// ─────────────────────────────────────────────────────────────

function ImportFAB({ onScanQR, onImportUrl }: { onScanQR: () => void; onImportUrl: () => void }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.fabContainer} pointerEvents="box-none">
      {open && (
        <>
          <Pressable style={styles.fabBackdrop} onPress={() => setOpen(false)} />
          <View style={[styles.fabMenu, { backgroundColor: theme.background, shadowColor: theme.text }]}>
            <Pressable
              onPress={() => { setOpen(false); onScanQR(); }}
              style={({ pressed }) => [styles.fabMenuItem, pressed && { opacity: 0.7 }]}>
              <ThemedText type="small">扫描二维码</ThemedText>
            </Pressable>
            <View style={[styles.fabMenuDivider, { backgroundColor: theme.backgroundElement }]} />
            <Pressable
              onPress={() => { setOpen(false); onImportUrl(); }}
              style={({ pressed }) => [styles.fabMenuItem, pressed && { opacity: 0.7 }]}>
              <ThemedText type="small">导入订阅链接</ThemedText>
            </Pressable>
          </View>
        </>
      )}
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={({ pressed }) => [
          styles.fab,
          { backgroundColor: '#007AFF', opacity: pressed ? 0.8 : 1 },
        ]}>
        <ThemedText style={styles.fabIcon}>{open ? '✕' : '+'}</ThemedText>
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
  // 本地异步调用期间 OR VPN 处于过渡状态（connecting/disconnecting）时均显示 loading
  const loading = localLoading || status === VPN_STATUS.STARTING || status === VPN_STATUS.STOPPING;
  const [hasConfig, setHasConfig] = useState<boolean>(() => !!SBConfig.getConfigContent());
  const [cameraVisible, setCameraVisible] = useState(false);
  const [importUrlVisible, setImportUrlVisible] = useState(false);
  const [nodeList, setNodeList] = useState<{ tag: string; delay: number }[]>([]);
  const [currentNode, setCurrentNode] = useState<string>('');
  const [nodeError, setNodeError] = useState<string | null>(null);

  // Re-check config on focus
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
        // 统一使用 libbox CommandClient IPC 查询 ExitGateway 分组（iOS/Android 一致）
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
      // 统一使用 libbox StandaloneCommandClient IPC 切换节点（iOS/Android 一致）
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

        {/* Nodes */}
        <View style={styles.nodeSectionHeader}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.nodeSectionTitle}>
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
        <ScrollView
          style={styles.nodeList}
          contentContainerStyle={styles.nodeListContent}
          showsVerticalScrollIndicator={false}>
          {nodeList.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.nodeEmptyHint}>
              {nodeError ? `⚠  ${nodeError}` : connected ? '加载中…' : '暂无节点'}
            </ThemedText>
          ) : (
            nodeList.map((node) => (
              <NodeRow
                key={node.tag}
                tag={node.tag}
                delay={node.delay}
                selected={currentNode === node.tag}
                onSelect={() => handleNodeSelect(node.tag)}
              />
            ))
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
// Styles
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

  // ── Header ────────────────────────────────────────────────
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Spacing.two,
    paddingBottom: Spacing.one,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  // ── Hero ──────────────────────────────────────────────────
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

  // Speed
  speedRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  speedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
    borderRadius: 20,
    gap: 4,
  },
  speedArrow: {
    fontSize: 12,
    fontWeight: '600',
  },
  speedValue: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
  },

  // ── Mode selector ─────────────────────────────────────────
  modeSelectorWrap: {
    alignItems: 'center',
    marginBottom: Spacing.four,
  },
  modeSel: {
    flexDirection: 'row',
    borderRadius: 14,
    padding: 3,
    gap: 2,
  },
  modeOpt: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.one + 3,
    borderRadius: 11,
    alignItems: 'center',
  },

  // ── Node section ──────────────────────────────────────────
  nodeSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.two,
    paddingHorizontal: Spacing.one,
    gap: Spacing.two,
  },
  nodeSectionTitle: {
    letterSpacing: 0.2,
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
    gap: Spacing.one,
    paddingBottom: Spacing.two,
  },
  nodeEmptyHint: {
    paddingHorizontal: Spacing.one,
  },
  nodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 4,
    borderRadius: 12,
    gap: Spacing.two + 2,
  },
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
  nodeName: {
    flex: 1,
    fontSize: 14,
  },
  nodeDelay: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    flexShrink: 0,
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
  fab: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  fabIcon: {
    color: '#fff',
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '300',
  },
  fabMenu: {
    borderRadius: 14,
    marginBottom: Spacing.two,
    minWidth: 176,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 10,
    overflow: 'hidden',
  },
  fabMenuItem: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 6,
  },
  fabMenuDivider: {
    height: StyleSheet.hairlineWidth,
  },

  // ── Import URL modal ──────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalSheetWrapper: {
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.five + 16,
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: Spacing.three,
  },
  urlInput: {
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 4,
    fontSize: 16,
    marginBottom: Spacing.two,
  },
  primaryBtn: {
    borderRadius: 12,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    backgroundColor: '#007AFF',
  },
  primaryBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },

  // ── Empty state ───────────────────────────────────────────
  emptyRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.five,
  },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.four,
  },
  emptyIcon: {
    fontSize: 36,
    lineHeight: 44,
  },
  emptyTitle: {
    textAlign: 'center',
    marginBottom: Spacing.two,
  },
  emptySubtitle: {
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: Spacing.five,
  },
  emptyActions: {
    width: '100%',
    gap: Spacing.two,
  },
  emptyBtn: {
    borderRadius: 14,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  emptyBtnPrimary: {
    backgroundColor: '#007AFF',
  },
  emptyBtnPrimaryText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
});
