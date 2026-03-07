import { ConnectButton } from '@/components/ui/home/connect-button';
import { FAB_CLEARANCE } from '@/components/ui/home/import-fab';
import { NodeList } from '@/components/ui/home/node-list';
import { SpeedRow } from '@/components/ui/home/speed-row';
import { SubInfo, SubscriptionInfoCard } from '@/components/ui/home/subscription-info-card';
import { useTheme } from '@/hooks/use-theme';
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
    FadeIn,
    FadeInDown,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from 'react-native-reanimated';

interface ConnectedLayoutProps {
    loading: boolean;
    subInfo: SubInfo;
    onPress: () => void;
}

export function ConnectedLayout({ loading, subInfo, onPress }: ConnectedLayoutProps) {
    const theme = useTheme();

    const floatY = useSharedValue(0);
    useEffect(() => {
        floatY.value = withSpring(-12, { damping: 20, stiffness: 160 });
    }, [floatY]);
    const floatStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: floatY.value }],
    }));

    return (
        <Animated.View entering={FadeIn.duration(260)} style={{ flex: 1 }}>
            {/* Top: Hero button + speed */}
            <Animated.View style={[{ alignItems: 'center', paddingTop: 32 }, floatStyle]}>
                <ConnectButton connected loading={loading} onPress={onPress} />
                <Animated.View
                    entering={FadeIn.duration(400).delay(180)}
                    style={{ marginTop: 16, alignItems: 'center' }}
                >
                    <SpeedRow />
                    <SubscriptionInfoCard info={subInfo} />
                </Animated.View>
            </Animated.View>

            {/* Flexible spacer */}
            <View style={{ flex: 1, minHeight: 32, maxHeight: 80 }} />

            {/* Bottom: Node list */}
            <Animated.View entering={FadeInDown.duration(320).delay(100)}>
                <View
                    style={{
                        height: 0.5,
                        backgroundColor: theme.backgroundElement,
                        marginHorizontal: 2,
                        marginBottom: 14,
                    }}
                />
                <NodeList bottomPadding={FAB_CLEARANCE} />
            </Animated.View>
        </Animated.View>
    );
}
