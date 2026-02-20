import React from 'react';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { View } from 'react-native';

export default function TabLayout() {

  return (
    <View style={{ flex: 1 }}>
      <AnimatedSplashOverlay />
      <AppTabs />
    </View>
  );
}
