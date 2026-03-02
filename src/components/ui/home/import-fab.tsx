import { ThemedText } from '@/components/themed-text';
import { lightImpact } from '@/components/ui/haptics';
import { useTheme } from '@/hooks/use-theme';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

interface ImportFABProps {
    onScanQR: () => void;
    onImportUrl: () => void;
}

/** Floating action button for quick-access import options */
export function ImportFAB({ onScanQR, onImportUrl }: ImportFABProps) {
    const theme = useTheme();
    const [open, setOpen] = useState(false);

    return (
        <View
            style={{ position: 'absolute', bottom: 96, right: 16, alignItems: 'flex-end', zIndex: 50 }}
            pointerEvents="box-none"
        >
            {/* Popup menu */}
            {open && (
                <>
                    <Pressable
                        style={{ position: 'absolute', top: -9999, bottom: -9999, left: -9999, right: -9999 }}
                        onPress={() => setOpen(false)}
                    />
                    <View
                        style={{
                            borderRadius: 16,
                            marginBottom: 12,
                            overflow: 'hidden',
                            backgroundColor: theme.background,
                            shadowColor: '#000',
                            shadowOffset: { width: 0, height: 4 },
                            shadowOpacity: 0.12,
                            shadowRadius: 12,
                            elevation: 8,
                        }}
                    >
                        <Pressable
                            onPress={() => { setOpen(false); lightImpact(); onScanQR(); }}
                            style={({ pressed }) => ({ paddingHorizontal: 16, paddingVertical: 12, opacity: pressed ? 0.7 : 1 })}
                        >
                            <ThemedText type="small">扫描二维码</ThemedText>
                        </Pressable>
                        <View style={{ height: 0.5, marginHorizontal: 12, backgroundColor: theme.backgroundElement }} />
                        <Pressable
                            onPress={() => { setOpen(false); lightImpact(); onImportUrl(); }}
                            style={({ pressed }) => ({ paddingHorizontal: 16, paddingVertical: 12, opacity: pressed ? 0.7 : 1 })}
                        >
                            <ThemedText type="small">导入订阅链接</ThemedText>
                        </Pressable>
                    </View>
                </>
            )}

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
                    opacity: pressed ? 0.8 : 1,
                    shadowColor: '#007AFF',
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.3,
                    shadowRadius: 8,
                    elevation: 6,
                })}
            >
                <ThemedText style={{ color: '#fff', fontSize: 24, lineHeight: 28, fontWeight: '300' }}>
                    {open ? '✕' : '+'}
                </ThemedText>
            </Pressable>
        </View>
    );
}
