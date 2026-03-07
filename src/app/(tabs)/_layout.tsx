import React from 'react';

import AppTabs from '@/components/app-tabs';
import { View } from 'react-native';

export default function TabLayout() {
  return (
    <View className="flex-1">
      <AppTabs />
    </View>
  );
}
