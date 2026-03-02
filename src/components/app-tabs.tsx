/**
 * Native tab bar — 2 tabs mapping to the core user tasks.
 * Uses expo-router NativeTabs for platform-native feel on iOS (UITabBarController).
 */
import { Colors } from '@/constants/theme';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import React from 'react';
import { useColorScheme } from 'react-native';

export default function AppTabs() {
    const scheme = useColorScheme();
    const colors = Colors[scheme === 'unspecified' ? 'light' : scheme];

    return (
        <NativeTabs
            backgroundColor={colors.background}
            indicatorColor={colors.backgroundElement}
            labelStyle={{ selected: { color: colors.text } }}
        >
            <NativeTabs.Trigger name="index">
                <NativeTabs.Trigger.Label>连接</NativeTabs.Trigger.Label>
                <NativeTabs.Trigger.Icon sf="shield.fill" md="home" />
            </NativeTabs.Trigger>

            <NativeTabs.Trigger name="explore">
                <NativeTabs.Trigger.Label>监控</NativeTabs.Trigger.Label>
                <NativeTabs.Trigger.Icon sf="chart.bar.fill" md="settings" />
            </NativeTabs.Trigger>
        </NativeTabs>
    );
}
