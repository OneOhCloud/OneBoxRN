import { CONFIG_REFRESH_TASK } from '@/tasks/config-refresh';
import { Card } from './card';
import { Row } from './row';

interface BackgroundTaskCardProps {
    isRegistered: boolean;
    index?: number;
}

export function BackgroundTaskCard({ isRegistered, index }: BackgroundTaskCardProps) {
    return (
        <Card title="Background Task" index={index}>
            <Row
                iconName="timer-outline"
                iconColor="#5856D6"
                label="Task Name"
                value={CONFIG_REFRESH_TASK}
            />
            <Row
                iconName={isRegistered ? 'checkmark-circle' : 'close-circle'}
                iconColor={isRegistered ? '#34C759' : '#FF3B30'}
                label="Registered"
                value={isRegistered ? 'Yes' : 'No'}
                valueColor={isRegistered ? '#34C759' : '#FF3B30'}
                valueMono={false}
                isLast
            />
        </Card>
    );
}
