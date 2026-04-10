import { CONFIG_REFRESH_TASK } from '@/tasks/config-refresh';
import { Card } from './card';
import { Row } from './row';

interface BackgroundTaskCardProps {
    isRegistered: boolean;
}

export function BackgroundTaskCard({ isRegistered }: BackgroundTaskCardProps) {
    return (
        <Card title="Background Task">
            <Row
                label="Task Name"
                value={CONFIG_REFRESH_TASK}
            />
            <Row
                label="Registered"
                value={isRegistered ? 'Yes' : 'No'}
                valueColor={isRegistered ? '#34C759' : '#FF3B30'}
                isLast
            />
        </Card>
    );
}
