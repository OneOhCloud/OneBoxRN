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
        <Card title="Subscription Config">
            <Row
                label="Config URL"
                value={link ?? 'None'}
                valueColor={link ? undefined : '#FF3B30'}
            />
            <Row
                label="Content Size"
                value={formatBytes(contentLength)}
            />
            <Row
                label="Used Traffic"
                value={formatBytes(usedTraffic)}
            />
            <Row
                label="Total Traffic"
                value={formatBytes(totalTraffic)}
            />
            <Row
                label="Expire Time"
                value={expireDate}
                isLast
            />
        </Card>
    );
}
