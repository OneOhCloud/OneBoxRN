import type { TaskStatus, TriggerSource } from '@/database/kv';

export { formatBytes } from './format-bytes';

export function taskStatusColor(status: TaskStatus): string {
    switch (status) {
        case 'success': return '#34C759';
        case 'skipped': return '#FF9500';
        case 'failed': return '#FF3B30';
    }
}

export function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
}

export function formatTime(iso: string): string {
    const d = new Date(iso);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

export function triggerLabel(trigger: TriggerSource | undefined): string {
    switch (trigger) {
        case 'manual-direct': return 'Direct';
        case 'auto': return 'Auto';
        default: return 'Auto';
    }
}

export function triggerColor(trigger: TriggerSource | undefined): string {
    switch (trigger) {
        case 'manual-direct': return '#007AFF';
        default: return '#8E8E93';
    }
}

// 回落加载用橙色凸显；主路径保持中性色。
export function methodColor(method: string): string {
    return method === 'primary' ? '#8E8E93' : '#FF9500';
}
