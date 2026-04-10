import { lightImpact } from '@/components/ui/haptics';
import { useTheme } from '@/hooks/use-theme';
import { executeConfigRefresh, registerConfigRefreshTask } from '@/tasks/config-refresh';
import { Alert, Pressable, StyleSheet, Text } from 'react-native';
import { Card } from './card';

interface DebugActionsCardProps {
    onExecuted: () => void;
}

export function DebugActionsCard({ onExecuted }: DebugActionsCardProps) {
    const theme = useTheme();

    const handleExecuteDirectly = async () => {
        lightImpact();
        try {
            console.log('[Dev] executing config refresh directly...');
            const result = await executeConfigRefresh();
            const label = result?.status === 'success' ? 'Success' : (result?.status ?? 'No URL');
            Alert.alert('Task Result', `${label}\nCheck logs for details.`);
            onExecuted();
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn('[Dev] direct execute error:', e);
            Alert.alert('Execute Error', msg);
        }
    };

    const handleReregister = async () => {
        lightImpact();
        try {
            console.log('[Dev] re-registering native background task...');
            await registerConfigRefreshTask();
            Alert.alert('Re-register', 'Task has been re-registered. Check logs.');
            onExecuted();
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn('[Dev] re-register error:', e);
            Alert.alert('Re-register Error', msg);
        }
    };

    return (
        <Card title="Debug Actions">
            <Pressable
                onPress={handleExecuteDirectly}
                style={({ pressed }) => ({
                    paddingVertical: 12,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: theme.border,
                    opacity: pressed ? 0.6 : 1,
                })}
            >
                <Text style={{ fontSize: 14, color: '#007AFF', textAlign: 'center', fontWeight: '600' }}>
                    Execute Directly
                </Text>
            </Pressable>
            <Pressable
                onPress={handleReregister}
                style={({ pressed }) => ({
                    paddingVertical: 12,
                    opacity: pressed ? 0.6 : 1,
                })}
            >
                <Text style={{ fontSize: 14, color: '#FF9500', textAlign: 'center', fontWeight: '600' }}>
                    Re-register Task
                </Text>
            </Pressable>
        </Card>
    );
}
