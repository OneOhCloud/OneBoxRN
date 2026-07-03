/**
 * 原生 tab bar —— 3 个 tab 对应核心用户任务。
 * 使用 expo-router NativeTabs，在 iOS 上获得平台原生观感（UITabBarController）。
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
                <NativeTabs.Trigger.Icon sf="shield.fill" md="security" />
            </NativeTabs.Trigger>

            <NativeTabs.Trigger name="profile">
                <NativeTabs.Trigger.Label>{i18n.t('tab_profiles')}</NativeTabs.Trigger.Label>
                <NativeTabs.Trigger.Icon sf="rectangle.stack.fill" md="layers" />
            </NativeTabs.Trigger>

            <NativeTabs.Trigger name="settings">
                <NativeTabs.Trigger.Label>{i18n.t('tab_settings')}</NativeTabs.Trigger.Label>
                <NativeTabs.Trigger.Icon sf="gearshape.fill" md="settings" />
            </NativeTabs.Trigger>
        </NativeTabs>
    );
}
