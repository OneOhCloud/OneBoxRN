/**
 * Native tab bar — 3 tabs mapping to the core user tasks.
 * Uses expo-router NativeTabs for platform-native feel on iOS (UITabBarController).
 */
import i18n from '@/constants/language';
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
                <NativeTabs.Trigger.Label>{i18n.t('tab_connect')}</NativeTabs.Trigger.Label>
                <NativeTabs.Trigger.Icon sf="shield.fill" md="vpn_key" />
            </NativeTabs.Trigger>

            <NativeTabs.Trigger name="info">
                <NativeTabs.Trigger.Label>{i18n.t('tab_info')}</NativeTabs.Trigger.Label>
                <NativeTabs.Trigger.Icon sf="chart.bar.fill" md="bar_chart" />
            </NativeTabs.Trigger>

            <NativeTabs.Trigger name="settings">
                <NativeTabs.Trigger.Label>{i18n.t('tab_settings')}</NativeTabs.Trigger.Label>
                <NativeTabs.Trigger.Icon sf="gearshape.fill" md="settings" />
            </NativeTabs.Trigger>
        </NativeTabs>
    );
}
