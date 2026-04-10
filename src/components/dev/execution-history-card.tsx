import type { TaskLogEntry } from '@/database/kv';
import { relativeTime, taskStatusColor } from '@/utils/dev-utils';
import { Card } from './card';
import { RecordRow } from './record-row';
import { Row } from './row';

interface ExecutionHistoryCardProps {
    taskLog: TaskLogEntry | null;
}

export function ExecutionHistoryCard({ taskLog }: ExecutionHistoryCardProps) {
    const records = taskLog?.records ? [...taskLog.records].reverse() : [];

    return (
        <>
            <Card title="Execution History">
                {taskLog ? (
                    <>
                        <Row
                            label="Total Runs"
                            value={String(taskLog.totalCount)}
                        />
                        <Row
                            label="Last Run"
                            value={taskLog.lastExecutedAt ? relativeTime(taskLog.lastExecutedAt) : 'Never'}
                            valueColor={taskLog.lastExecutedAt ? undefined : undefined}
                        />
                        <Row
                            label="Last Status"
                            value={taskLog.lastStatus ?? '—'}
                            valueColor={taskLog.lastStatus ? taskStatusColor(taskLog.lastStatus) : undefined}
                            isLast={records.length === 0}
                        />
                    </>
                ) : (
                    <Row label="Status" value="No config URL" isLast />
                )}
            </Card>

            {records.length > 0 && (
                <Card title={`Recent Records (${records.length})`}>
                    {records.map((r, i) => (
                        <RecordRow
                            key={r.time + i}
                            record={r}
                            isLast={i === records.length - 1}
                        />
                    ))}
                </Card>
            )}
        </>
    );
}
