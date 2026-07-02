import { lightImpact } from '@/components/ui/haptics';
import { LastFailure } from '@/database/kv';
import { useState } from 'react';
import { Card } from './card';
import { Row } from './row';

/**
 * Read surface for the durable latest-failure snapshot (F-05): persists
 * independently of the in-memory log ring, so it survives "clear logs".
 * Grep the Logs viewer for `flow=<id>` to see the full trace (while the
 * ring still holds it).
 */
export function LastFailureCard({ index }: { index?: number }) {
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
        <Card title="Last Failure" index={index}>
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
