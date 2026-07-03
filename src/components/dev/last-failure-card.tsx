import { lightImpact } from '@/components/ui/haptics';
import { LastFailure } from '@/database/kv';
import { useState } from 'react';
import { Card } from './card';
import { Row } from './row';

/**
 * 持久化的最近一次失败快照的只读展示面。独立于内存中的日志 ring 持久化，
 * 因此「清空日志」后依然保留。在 Logs 查看器中 grep `flow=<id>` 可看到完整
 * trace（前提是 ring 中仍保留着）。
 */
export function LastFailureCard() {
    const [summary, setSummary] = useState(() => LastFailure.get());

    const refresh = () => {
        lightImpact();
        setSummary(LastFailure.get());
    };

    const clear = () => {
        lightImpact();
        LastFailure.clear();
        setSummary(null);
    };

    return (
        <Card title="Last Failure">
            {summary ? (
                <>
                    <Row label="Event" value={summary.event} />
                    <Row label="Phase" value={summary.phase ?? '—'} />
                    <Row label="Error Code" value={summary.errorCode ?? '—'} valueColor="#FF3B30" />
                    <Row label="Flow ID" value={summary.flowId} />
                    <Row label="Platform" value={summary.platform} />
                    <Row label="Time" value={summary.time} />
                    {summary.detail ? <Row label="Detail" value={summary.detail} /> : null}
                </>
            ) : (
                <Row label="No recorded failure" valueMono={false} />
            )}
            <Row
                iconName="refresh-outline"
                iconColor="#007AFF"
                label="Refresh"
                onPress={refresh}
            />
            <Row
                iconName="trash-outline"
                iconColor="#FF9500"
                label="Clear"
                onPress={clear}
                isLast
            />
        </Card>
    );
}
