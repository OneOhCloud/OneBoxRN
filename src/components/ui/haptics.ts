/**
 * Haptic feedback utilities - wraps expo-haptics for consistent tactile responses.
 * All functions are safe to call on any platform (no-op on web).
 */
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

const isNative = Platform.OS === 'ios' || Platform.OS === 'android';

/** Light tap — for selections, toggles, minor interactions */
export function lightImpact() {
    if (isNative) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

/** Medium impact — for primary button presses (e.g. connect/disconnect) */
export function mediumImpact() {
    if (isNative) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
}

/** Selection change — for pickers, segmented controls, list selection */
export function selectionChanged() {
    if (isNative) Haptics.selectionAsync();
}

/** Success notification — for completed operations */
export function notifySuccess() {
    if (isNative) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}

/** Error notification — for failed operations */
export function notifyError() {
    if (isNative) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
}
