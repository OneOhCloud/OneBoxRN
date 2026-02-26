import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import CameraQR from '@/components/ui/camera-qr';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { getProcessedConfig } from '@/database/helper';
import { SBConfig } from '@/database/kv';
import { configType } from '@/definition';
import { useTheme } from '@/hooks/use-theme';
import ExpoOnebox from '@/modules/expo-onebox';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';


// ---- Empty state ----

function EmptyState({ onScanQR }: { onScanQR: () => void }) {
  const theme = useTheme();
  const [url, setUrl] = useState('');

  function handleImportUrl() {
    const trimmed = url.trim();
    if (!trimmed.startsWith('https://')) {
      Alert.alert('链接无效', '请输入以 https:// 开头的订阅链接');
      return;
    }
    router.push(`/config?data=${encodeURIComponent(btoa(trimmed))}`);
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.emptyRoot}>
      <View style={styles.emptyInner}>
        <ThemedText type="subtitle" style={{ textAlign: 'center' }}>
          导入配置
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={{ textAlign: 'center', marginTop: Spacing.two }}>
          扫描二维码或粘贴订阅链接以开始使用
        </ThemedText>

        <Pressable
          onPress={onScanQR}
          style={({ pressed }) => [
            styles.primaryButton,
            { backgroundColor: '#007AFF', opacity: pressed ? 0.8 : 1, marginTop: Spacing.five },
          ]}>
          <ThemedText style={{ color: '#ffffff', fontWeight: '600', fontSize: 16 }}>
            扫描二维码
          </ThemedText>
        </Pressable>

        <View style={styles.dividerRow}>
          <View style={[styles.dividerLine, { backgroundColor: theme.backgroundElement }]} />
          <ThemedText type="small" themeColor="textSecondary" style={{ marginHorizontal: Spacing.two }}>
            或
          </ThemedText>
          <View style={[styles.dividerLine, { backgroundColor: theme.backgroundElement }]} />
        </View>

        <TextInput
          style={[
            styles.urlInput,
            {
              backgroundColor: theme.backgroundElement,
              color: theme.text,
            },
          ]}
          placeholder="粘贴订阅链接 https://"
          placeholderTextColor={theme.textSecondary}
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={handleImportUrl}
        />

        <Pressable
          onPress={handleImportUrl}
          style={({ pressed }) => [
            styles.secondaryButton,
            { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.8 : 1 },
          ]}>
          <ThemedText style={{ fontWeight: '600', fontSize: 16 }}>
            导入链接
          </ThemedText>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

// ---- Mock node data (replace with real data later) ----
type NodeItem = {
  tag: string;
  name: string;
  region: string;
  latency: number | null;
};

const MOCK_NODES: NodeItem[] = [
  { tag: 'auto', name: '自动选择', region: '', latency: null },
  { tag: 'hk-01', name: 'Hong Kong 01', region: 'HK', latency: 32 },
  { tag: 'sg-01', name: 'Singapore 01', region: 'SG', latency: 45 },
  { tag: 'jp-01', name: 'Japan 01', region: 'JP', latency: 68 },
  { tag: 'us-01', name: 'United States 01', region: 'US', latency: 180 },
  { tag: 'de-01', name: 'Germany 01', region: 'DE', latency: 210 },
];

// ---- Sub-components ----

function StatusDot({ connected }: { connected: boolean }) {
  const color = connected ? '#34C759' : '#8E8E93';
  return <View style={[styles.statusDot, { backgroundColor: color }]} />;
}

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
  const bgColor = connected ? '#34C759' : theme.backgroundElement;
  const textColor = connected ? '#ffffff' : theme.text;
  const label = loading ? '请稍候' : connected ? '已连接' : '连接';

  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      style={({ pressed }) => [
        styles.connectButton,
        { backgroundColor: bgColor, opacity: pressed || loading ? 0.75 : 1 },
      ]}>
      <ThemedText
        style={[styles.connectButtonText, { color: textColor }]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function ModeSelector({
  mode,
  onChange,
}: {
  mode: configType;
  onChange: (m: configType) => void;
}) {
  const theme = useTheme();
  const options: { label: string; value: configType }[] = [
    { label: '规则', value: 'tun-rules' },
    { label: '全局', value: 'tun-global' },
  ];

  return (
    <View style={[styles.modeSelector, { backgroundColor: theme.backgroundElement }]}>
      {options.map((opt) => {
        const active = mode === opt.value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={[
              styles.modeOption,
              active && { backgroundColor: theme.background },
            ]}>
            <ThemedText
              type="small"
              style={{ fontWeight: active ? '600' : '400' }}>
              {opt.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

function NodeRow({
  node,
  selected,
  onSelect,
}: {
  node: NodeItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const theme = useTheme();
  const latencyColor =
    node.latency === null
      ? theme.textSecondary
      : node.latency < 80
        ? '#34C759'
        : node.latency < 150
          ? '#FF9500'
          : '#FF3B30';

  return (
    <Pressable
      onPress={onSelect}
      style={({ pressed }) => [
        styles.nodeRow,
        { backgroundColor: selected ? theme.backgroundSelected : theme.backgroundElement },
        pressed && { opacity: 0.7 },
      ]}>
      <View style={styles.nodeRowLeft}>
        <ThemedText type="small" style={{ fontWeight: selected ? '600' : '400' }}>
          {node.name}
        </ThemedText>
        {node.region ? (
          <ThemedText type="small" themeColor="textSecondary">
            {node.region}
          </ThemedText>
        ) : null}
      </View>
      <View style={styles.nodeRowRight}>
        {node.latency !== null ? (
          <ThemedText type="small" style={{ color: latencyColor }}>
            {node.latency} ms
          </ThemedText>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            ---
          </ThemedText>
        )}
        {selected && (
          <View style={[styles.checkmark, { borderColor: theme.text }]} />
        )}
      </View>
    </Pressable>
  );
}

// ---- Main screen ----

export default function HomeScreen() {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<configType>(() => SBConfig.getMode());
  const [selectedNode, setSelectedNode] = useState<string>(MOCK_NODES[0].tag);
  const [hasConfig, setHasConfig] = useState<boolean>(() => !!SBConfig.getConfigContent());
  const [cameraVisible, setCameraVisible] = useState(false);

  // Re-check config whenever screen comes back into focus (e.g. returning from /config)
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

  const handleModeChange = useCallback((m: configType) => {
    setMode(m);
    SBConfig.setMode(m);
  }, []);

  const handleToggleConnect = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      if (connected) {
        // await ExpoOneBox.Stop();
        setConnected(false);
      } else {
        const config = await getProcessedConfig();
        //await ExpoOneBox.Start(config);
        setConnected(true);
      }
    } catch (e: any) {
      Alert.alert('错误', e?.message ?? '操作失败');
    } finally {
      setLoading(false);
    }
  }, [connected, loading]);

  // Re-check config when returning from config screen
  const handleCameraClose = useCallback(() => {
    setCameraVisible(false);
    setHasConfig(!!SBConfig.getConfigContent());
  }, []);

  if (!hasConfig) {
    return (
      <ThemedView style={styles.root}>
        <SafeAreaView style={[styles.safeArea, { justifyContent: 'center' }]}>
          <EmptyState onScanQR={() => setCameraVisible(true)} />
        </SafeAreaView>
        <Modal
          visible={cameraVisible}
          animationType="slide"
          onRequestClose={handleCameraClose}>
          <View style={{ flex: 1, backgroundColor: 'black' }}>
            <CameraQR onHandleClose={handleCameraClose} />
          </View>
        </Modal>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea}>
        {ExpoOnebox.hello()}
        {/* ---- Status bar ---- */}
        <View style={styles.statusRow}>
          <StatusDot connected={connected} />
          <ThemedText type="small" themeColor="textSecondary">
            {connected ? '已连接' : '未连接'}
          </ThemedText>
        </View>

        {/* ---- Connect button ---- */}
        <View style={styles.heroSection}>
          <ConnectButton
            connected={connected}
            loading={loading}
            onPress={handleToggleConnect}
          />
          <ModeSelector mode={mode} onChange={handleModeChange} />
        </View>

        {/* ---- Node list ---- */}
        <ThemedText
          type="small"
          themeColor="textSecondary"
          style={styles.sectionLabel}>
          节点
        </ThemedText>
        <ScrollView
          style={styles.nodeList}
          contentContainerStyle={styles.nodeListContent}
          showsVerticalScrollIndicator={false}>
          {MOCK_NODES.map((node) => (
            <NodeRow
              key={node.tag}
              node={node}
              selected={selectedNode === node.tag}
              onSelect={() => setSelectedNode(node.tag)}
            />
          ))}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const BUTTON_SIZE = 140;

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
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.one,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  heroSection: {
    alignItems: 'center',
    paddingVertical: Spacing.five,
    gap: Spacing.three,
  },
  connectButton: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectButtonText: {
    fontSize: 20,
    fontWeight: '600',
  },
  modeSelector: {
    flexDirection: 'row',
    borderRadius: Spacing.two + 2,
    padding: 3,
    gap: 2,
  },
  modeOption: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.one + 2,
    borderRadius: Spacing.two,
    alignItems: 'center',
  },
  sectionLabel: {
    marginBottom: Spacing.two,
    paddingHorizontal: Spacing.one,
  },
  nodeList: {
    flex: 1,
  },
  nodeListContent: {
    gap: Spacing.one,
    paddingBottom: Spacing.two,
  },
  nodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    borderRadius: Spacing.two + 2,
  },
  nodeRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  nodeRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  checkmark: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#007AFF',
  },
  // Empty state
  emptyRoot: {
    flex: 1,
  },
  emptyInner: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.five,
  },
  primaryButton: {
    borderRadius: Spacing.two + 2,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: Spacing.three,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  urlInput: {
    borderRadius: Spacing.two + 2,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 4,
    fontSize: 16,
    marginBottom: Spacing.two,
  },
  secondaryButton: {
    borderRadius: Spacing.two + 2,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
});
