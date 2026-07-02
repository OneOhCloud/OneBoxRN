import { formatBytes } from '@/utils/dev-utils';
import { Card } from './card';
import { Row } from './row';

interface ConfigStateCardProps {
    link: string | null;
    contentLength: number;
    usedTraffic: number;
    totalTraffic: number;
    expireTime: number;
}

export function ConfigStateCard({
    link,
    contentLength,
    usedTraffic,
    totalTraffic,
    expireTime,
}: ConfigStateCardProps) {
    const expireDate = expireTime > 0
        ? new Date(expireTime * 1000).toLocaleString()
        : 'N/A';

    return (
        <Card title="Profile Config">
            <Row
                iconName="link-outline"
                iconColor="#5AC8FA"
                label="Config URL"
                value={link ?? 'None'}
                valueColor={link ? undefined : '#FF3B30'}
                valueMono={false}
            />
            <Row
                iconName="document-text-outline"
                iconColor="#AF52DE"
                label="Content Size"
                value={formatBytes(contentLength)}
            />
            <Row
                iconName="arrow-up-circle-outline"
                iconColor="#FF9500"
                label="Used Traffic"
                value={formatBytes(usedTraffic)}
            />
            <Row
                iconName="server-outline"
                iconColor="#34C759"
                label="Total Traffic"
                value={formatBytes(totalTraffic)}
            />
            <Row
                iconName="hourglass-outline"
                iconColor="#FF453A"
                label="Expire Time"
                value={expireDate}
                valueMono={false}
                isLast
            />
        </Card>
    );
}
