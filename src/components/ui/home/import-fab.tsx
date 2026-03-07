import { ThemedText } from '@/components/themed-text';
import { lightImpact } from '@/components/ui/haptics';
import i18n from '@/constants/language';
import { useTheme } from '@/hooks/use-theme';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Height of the FAB button + gap above it — use this to pad content that sits under the FAB */
export const FAB_CLEARANCE = 56 + 12; // button height + gap from tab bar top

interface ImportFABProps {
    onScanQR: () => void;
    onImportUrl: () => void;
}

/** Floating action button for quick-access import options */
export function ImportFAB({ onScanQR, onImportUrl }: ImportFABProps) {
    const theme = useTheme();
    const insets = useSafeAreaInsets();
    const [open, setOpen] = useState(false);

    const menuAnim = useRef(new Animated.Value(0)).current;
    const rotateAnim = useRef(new Animated.Value(0)).current;
    const item1Anim = useRef(new Animated.Value(0)).current;
    const item2Anim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        const springCfg = { useNativeDriver: true, tension: 260, friction: 22 };
        const closeCfg = { useNativeDriver: true, duration: 160 } as const;

        if (open) {
            Animated.parallel([
                Animated.spring(menuAnim, { toValue: 1, ...springCfg }),
                Animated.spring(rotateAnim, { toValue: 1, ...springCfg }),
                Animated.sequence([
                    Animated.delay(30),
                    Animated.spring(item1Anim, { toValue: 1, ...springCfg }),
                ]),
                Animated.sequence([
                    Animated.delay(70),
                    Animated.spring(item2Anim, { toValue: 1, ...springCfg }),
                ]),
            ]).start();
        } else {
            Animated.parallel([
                Animated.timing(menuAnim, { toValue: 0, ...closeCfg }),
                Animated.timing(rotateAnim, { toValue: 0, ...closeCfg }),
                Animated.timing(item1Anim, { toValue: 0, ...closeCfg }),
                Animated.timing(item2Anim, { toValue: 0, ...closeCfg }),
            ]).start();
        }
    }, [item1Anim, item2Anim, menuAnim, open, rotateAnim]);

    const fabRotate = rotateAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] });
    const menuScale = menuAnim.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1] });
    const item1Y = item1Anim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] });
    const item2Y = item2Anim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] });

    return (
        <View
            style={{ position: 'absolute', bottom: insets.bottom + 12, right: 16, alignItems: 'flex-end', zIndex: 50 }}
            pointerEvents="box-none"
        >
            {/* Dismiss overlay */}
            {open && (
                <Pressable
                    style={{ position: 'absolute', top: -9999, bottom: -9999, left: -9999, right: -9999 }}
                    onPress={() => setOpen(false)}
                />
            )}

            {/* Popup menu — always mounted so animations play correctly */}
            <Animated.View
                pointerEvents={open ? 'auto' : 'none'}
                style={{
                    opacity: menuAnim,
                    transform: [{ scale: menuScale }],
                    marginBottom: 14,
                    transformOrigin: 'bottom right',
                }}
            >
                <View
                    style={{
                        borderRadius: 20,
                        overflow: 'hidden',
                        backgroundColor: theme.backgroundElement,
                        borderWidth: 0.5,
                        borderColor: theme.backgroundSelected,
                        shadowColor: '#000',
                        shadowOffset: { width: 0, height: 10 },
                        shadowOpacity: 0.18,
                        shadowRadius: 28,
                        elevation: 12,
                        minWidth: 192,
                    }}
                >
                    {/* Item 1 – Scan QR */}
                    <Animated.View style={{ opacity: item1Anim, transform: [{ translateY: item1Y }] }}>
                        <Pressable
                            onPress={() => { setOpen(false); lightImpact(); onScanQR(); }}
                            style={({ pressed }) => ({
                                flexDirection: 'row',
                                alignItems: 'center',
                                paddingHorizontal: 14,
                                paddingVertical: 13,
                                gap: 13,
                                backgroundColor: pressed ? theme.backgroundSelected : 'transparent',
                            })}
                        >
                            <View
                                style={{
                                    width: 34, height: 34, borderRadius: 9,
                                    backgroundColor: '#30D158',
                                    alignItems: 'center', justifyContent: 'center',
                                    shadowColor: '#30D158',
                                    shadowOffset: { width: 0, height: 3 },
                                    shadowOpacity: 0.35,
                                    shadowRadius: 6,
                                }}
                            >
                                <Ionicons name="qr-code-outline" size={18} color="#fff" />
                            </View>
                            <ThemedText style={{ fontSize: 15, fontWeight: '500', letterSpacing: -0.3 }}>
                                {i18n.t('scan_qr')}
                            </ThemedText>
                        </Pressable>
                    </Animated.View>

                    <View style={{ height: 0.5, marginHorizontal: 14, backgroundColor: theme.backgroundSelected }} />

                    {/* Item 2 – Import URL */}
                    <Animated.View style={{ opacity: item2Anim, transform: [{ translateY: item2Y }] }}>
                        <Pressable
                            onPress={() => { setOpen(false); lightImpact(); onImportUrl(); }}
                            style={({ pressed }) => ({
                                flexDirection: 'row',
                                alignItems: 'center',
                                paddingHorizontal: 14,
                                paddingVertical: 13,
                                gap: 13,
                                backgroundColor: pressed ? theme.backgroundSelected : 'transparent',
                            })}
                        >
                            <View
                                style={{
                                    width: 34, height: 34, borderRadius: 9,
                                    backgroundColor: '#007AFF',
                                    alignItems: 'center', justifyContent: 'center',
                                    shadowColor: '#007AFF',
                                    shadowOffset: { width: 0, height: 3 },
                                    shadowOpacity: 0.35,
                                    shadowRadius: 6,
                                }}
                            >
                                <Ionicons name="link-outline" size={18} color="#fff" />
                            </View>
                            <ThemedText style={{ fontSize: 15, fontWeight: '500', letterSpacing: -0.3 }}>
                                {i18n.t('import_subscription_link')}
                            </ThemedText>
                        </Pressable>
                    </Animated.View>
                </View>
            </Animated.View>

            {/* FAB button */}
            <Pressable
                onPress={() => { lightImpact(); setOpen((v) => !v); }}
                style={({ pressed }) => ({
                    width: 56,
                    height: 56,
                    borderRadius: 28,
                    backgroundColor: '#007AFF',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transform: [{ scale: pressed ? 0.92 : 1 }],
                    shadowColor: '#007AFF',
                    shadowOffset: { width: 0, height: 6 },
                    shadowOpacity: open ? 0.5 : 0.38,
                    shadowRadius: 14,
                    elevation: 8,
                })}
            >
                <Animated.Text
                    style={{
                        color: '#fff',
                        fontSize: 26,
                        lineHeight: 30,
                        fontWeight: '200',
                        transform: [{ rotate: fabRotate }],
                        includeFontPadding: false,
                    }}
                >
                    +
                </Animated.Text>
            </Pressable>
        </View>
    );
}
