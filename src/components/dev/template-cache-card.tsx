import { mediumImpact } from '@/components/ui/haptics';
import {
    clearConfigTemplateCache,
    prefetchConfigTemplates,
    type TemplateCacheInfo,
} from '@/database/config-template';
import { Alert } from 'react-native';
import { Card } from './card';
import { Row } from './row';

interface TemplateCacheCardProps {
    /** 各模式的缓存状态，由父级聚合器获取。 */
    info: TemplateCacheInfo[] | null;
    onChanged?: () => void;
}

function formatAge(ageMs: number | null): string {
    if (ageMs === null) return '';
    const minutes = Math.floor(ageMs / 60_000);
    if (minutes < 1) return ' · just now';
    if (minutes < 60) return ` · ${minutes}m`;
    return ` · ${Math.floor(minutes / 60)}h`;
}

function statusValue(info: TemplateCacheInfo): string {
    const source = info.cached ? `remote${formatAge(info.ageMs)}` : 'built-in';
    const anchor = info.hasRejectAnchor ? 'anchor ✓' : 'anchor ✗';
    return `${source} · ${anchor}`;
}

// tun-global 按设计没有 action anchor；只有 rules 模式模板缺失 reject anchor
// 才是 stale-cache bug 的信号。
function isFlagged(info: TemplateCacheInfo): boolean {
    return info.mode === 'tun-rules' && !info.hasRejectAnchor;
}

export function TemplateCacheCard({ info, onChanged }: TemplateCacheCardProps) {
    const handleClear = () => {
        Alert.alert(
            'Clear Template Cache',
            'Drops the cached remote templates for all modes. The built-in template is used until the next refetch. Reconnect to rebuild the running config.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Clear',
                    style: 'destructive',
                    onPress: async () => {
                        mediumImpact();
                        try {
                            await clearConfigTemplateCache();
                            onChanged?.();
                            Alert.alert('Template Cache', 'Cleared. Reconnect to apply the built-in template.');
                        } catch (e) {
                            Alert.alert('Clear Error', e instanceof Error ? e.message : String(e));
                        }
                    },
                },
            ],
        );
    };

    const handleClearAndRefetch = async () => {
        mediumImpact();
        try {
            await clearConfigTemplateCache();
            await prefetchConfigTemplates();
            onChanged?.();
            Alert.alert('Template Cache', 'Cleared and refetched from remote.');
        } catch (e) {
            Alert.alert('Refetch Error', e instanceof Error ? e.message : String(e));
        }
    };

    return (
        <Card title="Config Template Cache">
            {(info ?? []).map((it) => (
                <Row
                    key={it.mode}
                    label={it.mode}
                    value={statusValue(it)}
                    valueColor={isFlagged(it) ? '#FF3B30' : undefined}
                    caption={isFlagged(it) ? 'Missing reject anchor — clear to recover.' : undefined}
                    isLast={false}
                />
            ))}
            <Row
                iconName="trash-outline"
                iconColor="#FF9500"
                label="Clear Template Cache"
                caption="Drop cached remote templates; fall back to built-in."
                onPress={handleClear}
                isLast={false}
            />
            <Row
                iconName="cloud-download-outline"
                iconColor="#007AFF"
                label="Clear & Refetch Now"
                caption="Clear, then immediately refetch templates from remote."
                onPress={handleClearAndRefetch}
                isLast
            />
        </Card>
    );
}
