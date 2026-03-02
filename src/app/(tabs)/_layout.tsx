import React from 'react';

import AppTabs from '@/components/app-tabs';
import { VpnProvider } from '@/contexts/vpn-context';
import { View } from 'react-native';

export default function TabLayout() {

  return (
    <VpnProvider>
      <View className="flex-1">
        <AppTabs />
      </View>
    </VpnProvider>
  );
}
