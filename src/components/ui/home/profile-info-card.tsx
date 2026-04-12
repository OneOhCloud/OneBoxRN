import i18n from '@/constants/language';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { StyleSheet, Text, View } from 'react-native';

/** Format a number with 1–3 significant digits, trimming trailing zeros. Matches iOS ByteCountFormatter behavior. */
function formatSignificant(n: number): string {
    if (n >= 100) return Math.round(n).toString();
    if (n >= 10) return n.toFixed(1).replace(/\.0$/, '');
    return n.toFixed(2).replace(/\.?0+$/, '');
}

export function fmtBytes(bytes: number): string {
    if (bytes <= 0) return '0 B';
    const KB = 1024;
    const MB = KB * 1024;
    const GB = MB * 1024;
    if (bytes < KB) return `${bytes} B`;
    if (bytes < MB) return `${formatSignificant(bytes / KB)} KB`;
    if (bytes < GB) return `${formatSignificant(bytes / MB)} MB`;
    return `${formatSignificant(bytes / GB)} GB`;
}

export interface SubInfo {
    used: number;
    total: number;
    expire: number;
}

export function ProfileInfoCard({ info }: { info: SubInfo }) {
    const theme = useTheme();
    if (info.expire === 0 && info.total <= 1) return null;

    const remaining = Math.max(0, info.total - info.used);
    const expireDate =
        info.expire > 0
            ? new Date(info.expire * 1000).toLocaleDateString(
                i18n.locale.startsWith('zh') ? 'zh-CN' : 'en-US',
                { year: 'numeric', month: '2-digit', day: '2-digit' }
            )
            : i18n.t('no_expire_info');

    return (
        <View style={styles.container}>
            <View style={styles.row}>
                <View style={styles.item}>
                    <Text style={[styles.label, { color: theme.textSecondary, fontFamily: Fonts?.sans }]}>
                        {i18n.t('expire_time')}
                    </Text>
                    <Text style={[styles.value, { color: theme.textSecondary, fontFamily: Fonts?.rounded }]}>
                        {expireDate}
                    </Text>
                </View>

                <View style={[styles.separator, { backgroundColor: theme.textSecondary }]} />

                <View style={styles.item}>
                    <Text style={[styles.label, { color: theme.textSecondary, fontFamily: Fonts?.sans }]}>
                        {i18n.t('remaining_traffic')}
                    </Text>
                    <Text style={[styles.value, { color: theme.textSecondary, fontFamily: Fonts?.rounded }]}>
                        {fmtBytes(remaining)}
                    </Text>
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        marginTop: 32,
        alignItems: 'center',
        width: "100%",
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 20,
    },
    item: {
        alignItems: 'center',
        gap: 3,
    },
    label: {
        fontSize: 10,
        letterSpacing: 0.4,
        opacity: 0.5,
    },
    value: {
        fontSize: 12,
        fontWeight: '500',
        letterSpacing: -0.1,
        opacity: 0.75,
    },
    separator: {
        width: 1.5,
        height: 20,
        borderRadius: 1,
        opacity: 0.15,
    },
});
