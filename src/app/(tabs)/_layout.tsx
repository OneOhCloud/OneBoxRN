import React from 'react';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { VpnProvider } from '@/contexts/vpn-context';
import { View } from 'react-native';

export default function TabLayout() {

  return (
    <VpnProvider>
      <View style={{ flex: 1 }}>
        <AnimatedSplashOverlay />
        <AppTabs />
      </View>
    </VpnProvider>
  );
}
