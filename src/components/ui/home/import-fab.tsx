import { ThemedText } from '@/components/themed-text';
import { lightImpact } from '@/components/ui/haptics';
import i18n from '@/constants/language';
import { useTheme } from '@/hooks/use-theme';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Divider, FAB, Surface } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const FAB_CLEARANCE = 56 + 12;

interface ImportFABProps {
    onScanQR: () => void;
    onImportUrl: () => void;
}

export function ImportFAB({ onScanQR, onImportUrl }: ImportFABProps) {
    const theme = useTheme();
    const insets = useSafeAreaInsets();
    const [open, setOpen] = useState(false);

    return (
        <View style={styles.container} pointerEvents="box-none">
            {/* 全屏透明遮罩 - 用于点击空白处关闭 */}
            {open && (
                <Pressable
                    style={StyleSheet.absoluteFill}
                    onPress={() => setOpen(false)}
                />
            )}

            <View style={[styles.content, { bottom: insets.bottom + 12 }]}>
                {/* 弹出菜单 */}
                {open && (
                    <Surface
                        style={[
                            styles.menu,
                            {
                                backgroundColor: theme.backgroundElement,
                                borderColor: theme.backgroundSelected
                            }
                        ]}
                        elevation={4}
                    >
                        <MenuItem
                            icon="qr-code"
                            color="#34C759"
                            label={i18n.t('scan_qr')}
                            onPress={() => { setOpen(false); onScanQR(); }}
                        />
                        <Divider style={[styles.divider, { backgroundColor: theme.backgroundSelected }]} />
                        <MenuItem
                            icon="link"
                            color="#007AFF"
                            label={i18n.t('import_subscription_link')}
                            onPress={() => { setOpen(false); onImportUrl(); }}
                        />
                    </Surface>
                )}

                {/* FAB 按钮 - 切换颜色以示区分 */}
                <FAB
                    icon={open ? 'close' : 'plus'}
                    onPress={() => { lightImpact(); setOpen(!open); }}
                    style={[
                        styles.fab,
                        { backgroundColor: open ? theme.backgroundSelected : '#007AFF' }
                    ]}
                    color={open ? theme.text : "#fff"}
                    size="medium"
                    animated={false}
                />
            </View>
        </View>
    );
}

/** 统一的菜单项组件 */
function MenuItem({ icon, color, label, onPress }: { icon: any, color: string, label: string, onPress: () => void }) {
    const theme = useTheme();
    return (
        <Pressable
            onPress={() => { lightImpact(); onPress(); }}
            style={({ pressed }) => [
                styles.item,
                { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }
            ]}
        >
            <View style={[styles.iconWrapper, { backgroundColor: color }]}>
                <Ionicons name={icon} size={18} color="#fff" />
            </View>
            <ThemedText style={styles.itemText}>{label}</ThemedText>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    container: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 50
    },
    content: {
        position: 'absolute',
        right: 16,
        alignItems: 'flex-end',
    },
    menu: {
        borderRadius: 24,
        borderWidth: 0.1, // 增加边框感，让深色模式下更有层次
        marginBottom: 12,
        minWidth: 210, // 略微加宽，避免文字拥挤
        overflow: 'hidden',
        // 优化阴影
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 10,
    },
    item: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 14,
        gap: 12,
    },
    iconWrapper: {
        width: 32,
        height: 32,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    itemText: {
        fontSize: 15,
        fontWeight: '600',
        letterSpacing: -0.2,
    },
    divider: {
        height: 1,
        marginHorizontal: 16,
    },
    fab: {
        width: 56,
        height: 56,
        borderRadius: 28,
        elevation: 4,
    },
});