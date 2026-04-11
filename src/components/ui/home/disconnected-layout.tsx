import { ThemedText } from '@/components/themed-text';
import { ConnectButton } from '@/components/ui/home/connect-button';
import { SubInfo, ProfileInfoCard } from '@/components/ui/home/profile-info-card';
import i18n from '@/constants/language';
import { View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';

interface DisconnectedLayoutProps {
    loading: boolean;
    subInfo: SubInfo;
    onPress: () => void;
}

export function DisconnectedLayout({ loading, subInfo, onPress }: DisconnectedLayoutProps) {
    return (
        <Animated.View
            entering={FadeIn.duration(260)}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
        >
            <ConnectButton connected={false} loading={loading} onPress={onPress} />
            {!loading && (
                <Animated.View
                    entering={FadeInDown.duration(300).delay(120)}
                    exiting={FadeOut.duration(150)}
                    style={{ alignItems: 'center' }}
                >
                    <ThemedText
                        themeColor="textSecondary"
                        style={{ fontSize: 14, fontWeight: '500', marginTop: 8, letterSpacing: 0.1 }}
                    >
                        {i18n.t('connect_hint')}
                    </ThemedText>
                    <View className='mt-8'>
                        <ProfileInfoCard info={subInfo} />
                    </View>
                </Animated.View>
            )}
        </Animated.View>
    );
}
