import { mediumImpact } from '@/components/ui/haptics';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const FAB_CLEARANCE = 56 + 12;

interface ImportFABProps {
    onImportUrl: () => void;
    visible?: boolean;
}

export function ImportFAB({ onImportUrl, visible = true }: ImportFABProps) {
    const insets = useSafeAreaInsets();

    if (!visible) return null;

    return (
        <View style={styles.container} pointerEvents="box-none">
            <View style={[styles.content, { bottom: insets.bottom + 12 }]}>
                <Pressable
                    onPress={() => {
                        mediumImpact();
                        onImportUrl();
                    }}
                    style={({ pressed }) => [
                        styles.fab,
                        { backgroundColor: pressed ? '#0051D5' : '#007AFF' }
                    ]}
                >
                    <Ionicons name="add" size={28} color="#fff" />
                </Pressable>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 50,
    },
    content: {
        position: 'absolute',
        right: 16,
        alignItems: 'flex-end',
    },
    fab: {
        width: 56,
        height: 56,
        borderRadius: 28,
        alignItems: 'center',
        justifyContent: 'center',
        elevation: 4,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
    },
});