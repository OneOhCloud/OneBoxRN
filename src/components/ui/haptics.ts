/**
 * 触觉反馈工具 — 封装 expo-haptics，提供一致的触感反馈。
 * 所有函数在任意平台调用都安全（web 上为 no-op）。
 */
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

const isNative = Platform.OS === 'ios' || Platform.OS === 'android';

/** 轻触 — 用于选择、切换等次要交互 */
export function lightImpact() {
    if (isNative) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

/** 中等冲击 — 用于主要按钮按下（如连接/断开） */
export function mediumImpact() {
    if (isNative) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
}

/** 选择变更 — 用于 picker、分段控件、列表选择 */
export function selectionChanged() {
    if (isNative) Haptics.selectionAsync();
}

/** 成功通知 — 用于已完成的操作 */
export function notifySuccess() {
    if (isNative) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}

/** 错误通知 — 用于失败的操作 */
export function notifyError() {
    if (isNative) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
}
