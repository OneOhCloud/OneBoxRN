import { mediumImpact } from '@/components/ui/haptics';
import { BugsnagCrashTestFlags, type BugsnagCrashTestKind } from '@/database/kv';
import ExpoOneBox from '@/modules/expo-onebox';
import { executeConfigRefresh, registerConfigRefreshTask } from '@/tasks/config-refresh';
import { Alert, Platform } from 'react-native';
import { Card } from './card';
import { Row } from './row';

interface DebugActionsCardProps {
    onExecuted: () => void;
    index?: number;
}

export function DebugActionsCard({ onExecuted, index }: DebugActionsCardProps) {
    const handleExecuteDirectly = async () => {
        mediumImpact();
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
        mediumImpact();
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

    // F-02 parity probe: a manual foreground refresh must never land in the
    // native last-result slot (reserved for true background runs). PASS =
    // getLastConfigRefreshResult() returns null right after a manual run.
    // Destructive: clear-on-read consumes any pending background result.
    const handleRefreshParityProbe = () => {
        Alert.alert(
            'Refresh Parity Probe',
            'Runs a manual refresh, then asserts the native last-result slot is empty.\n\nDestructive: consumes any pending background result.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Run',
                    onPress: async () => {
                        mediumImpact();
                        try {
                            // Drain anything a background run left behind first, so the
                            // assertion only sees what the manual run just did.
                            ExpoOneBox.getLastConfigRefreshResult();
                            const result = await executeConfigRefresh();
                            if (!result) {
                                Alert.alert('Parity Probe', 'SKIPPED — no config URL set.');
                                return;
                            }
                            const leaked = ExpoOneBox.getLastConfigRefreshResult();
                            if (leaked === null) {
                                Alert.alert('Parity Probe', 'PASS — manual result was not persisted.');
                            } else {
                                Alert.alert('Parity Probe', `FAIL — slot contains a result (timestamp=${leaked.timestamp}). Manual refreshes must not persist.`);
                            }
                            onExecuted();
                        } catch (e) {
                            Alert.alert('Parity Probe Error', e instanceof Error ? e.message : String(e));
                        }
                    },
                },
            ],
        );
    };

    const armCrashOnNextLaunch = (kind: BugsnagCrashTestKind) => {
        const title = kind === 'js' ? 'Arm JS Crash' : 'Arm Android Native Crash';
        const message = kind === 'js'
            ? 'The app will throw an uncaught JS error during the next startup.'
            : 'The app will throw a native Android RuntimeException during the next startup.';

        Alert.alert(title, `${message}\n\nRestart the app after arming this test.`, [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Arm',
                style: 'destructive',
                onPress: () => {
                    BugsnagCrashTestFlags.arm(kind);
                    Alert.alert('Crash Test Armed', 'Fully close and reopen the app to trigger it once.');
                    onExecuted();
                },
            },
        ]);
    };

    return (
        <Card title="Debug Actions" index={index}>
            <Row
                iconName="play-circle-outline"
                iconColor="#007AFF"
                label="Execute Directly"
                caption="Run the refresh task synchronously and show the result."
                onPress={handleExecuteDirectly}
            />
            <Row
                iconName="refresh-circle-outline"
                iconColor="#FF9500"
                label="Re-register Task"
                caption="Cancel and re-schedule the periodic worker."
                onPress={handleReregister}
                isLast={false}
            />
            <Row
                iconName="git-compare-outline"
                iconColor="#34C759"
                label="Refresh Parity Probe"
                caption="Manual refresh must not persist to the background slot (F-02)."
                onPress={handleRefreshParityProbe}
                isLast={false}
            />
            <Row
                iconName="bug-outline"
                iconColor="#FF3B30"
                label="Crash JS on Next Launch"
                caption="One-shot startup crash for Bugsnag JS error verification."
                onPress={() => armCrashOnNextLaunch('js')}
                isLast={Platform.OS !== 'android'}
            />
            {Platform.OS === 'android' ? (
                <Row
                    iconName="skull-outline"
                    iconColor="#AF52DE"
                    label="Crash Native on Next Launch"
                    caption="One-shot Android RuntimeException for Bugsnag native crash verification."
                    onPress={() => armCrashOnNextLaunch('native-android')}
                    isLast
                />
            ) : null}
        </Card>
    );
}
