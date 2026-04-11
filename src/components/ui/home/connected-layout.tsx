import { ConnectButton } from '@/components/ui/home/connect-button';
import { FAB_CLEARANCE } from '@/components/ui/home/import-fab';
import { NodeList } from '@/components/ui/home/node-list';
import { SubInfo, ProfileInfoCard } from '@/components/ui/home/profile-info-card';
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
import { SpeedRow } from './speed-row';

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

                </Animated.View>
            </Animated.View>

            {/* Flexible spacer */}
            <View style={{ flex: 1, minHeight: 16, maxHeight: 40 }} />

            {/* Bottom: Node list */}
            <Animated.View entering={FadeInDown.duration(320).delay(100)}>
                <View
                    style={{
                        height: 0.5,
                        backgroundColor: theme.background,
                        marginHorizontal: 2,
                        marginBottom: 14,
                    }}
                />
                <NodeList bottomPadding={FAB_CLEARANCE} />
            </Animated.View>
            <View style={{ flex: 1, minHeight: 8, maxHeight: 20 }} />

            <Animated.View
                className="mt-4"
                entering={FadeInDown.duration(320).delay(140)}
            >
                <ProfileInfoCard info={subInfo} />
            </Animated.View>

        </Animated.View>
    );
}
