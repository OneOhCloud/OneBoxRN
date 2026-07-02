import type { TaskLogEntry, TaskRecord } from '@/database/kv';
import { relativeTime, taskStatusColor } from '@/utils/dev-utils';
import { useState } from 'react';
import { Card } from './card';
import { RecordRow } from './record-row';
import { Row } from './row';
import { TaskDetailModal } from './task-detail-modal';

interface ExecutionHistoryCardProps {
    taskLog: TaskLogEntry | null;
}

export function ExecutionHistoryCard({ taskLog }: ExecutionHistoryCardProps) {
    const records = taskLog?.records ? [...taskLog.records].reverse() : [];
    const [selectedRecord, setSelectedRecord] = useState<TaskRecord | null>(null);

    return (
        <>
            <Card title="Execution History">
                {taskLog ? (
                    <>
                        <Row
                            iconName="stats-chart-outline"
                            iconColor="#5856D6"
                            label="Total Runs"
                            value={String(taskLog.totalCount)}
                        />
                        <Row
                            iconName="time-outline"
                            iconColor="#5AC8FA"
                            label="Last Run"
                            value={taskLog.lastExecutedAt ? relativeTime(taskLog.lastExecutedAt) : 'Never'}
                            valueMono={false}
                        />
                        <Row
                            iconName="pulse-outline"
                            iconColor={taskLog.lastStatus ? taskStatusColor(taskLog.lastStatus) : '#8E8E93'}
                            label="Last Status"
                            value={taskLog.lastStatus ?? '—'}
                            valueColor={taskLog.lastStatus ? taskStatusColor(taskLog.lastStatus) : undefined}
                            valueMono={false}
                            isLast
                        />
                    </>
                ) : (
                    <Row
                        iconName="help-circle-outline"
                        iconColor="#8E8E93"
                        label="Status"
                        value="No config URL"
                        valueMono={false}
                        isLast
                    />
                )}
            </Card>

            {records.length > 0 && (
                <Card title={`Recent Records`} subtitle={`${records.length} entries`}>
                    {records.map((r, i) => (
                        <RecordRow
                            key={r.time + i}
                            record={r}
                            isLast={i === records.length - 1}
                            onPress={() => setSelectedRecord(r)}
                        />
                    ))}
                </Card>
            )}

            <TaskDetailModal
                record={selectedRecord}
                visible={selectedRecord !== null}
                onClose={() => setSelectedRecord(null)}
            />
        </>
    );
}
