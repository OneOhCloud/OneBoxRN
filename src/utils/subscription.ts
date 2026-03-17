/**
 * Shared subscription header parser.
 * Used by both the manual import screen and the background refresh task.
 */
export interface SubscriptionInfo {
    upload: number;
    download: number;
    total: number;
    expire: number;
}

export function parseSubscriptionUserinfo(header: string | null): SubscriptionInfo {
    return {
        upload: parseInt(header?.match(/upload=(\d+)/)?.[1] ?? '0', 10),
        download: parseInt(header?.match(/download=(\d+)/)?.[1] ?? '0', 10),
        total: parseInt(header?.match(/total=(\d+)/)?.[1] ?? '0', 10),
        expire: parseInt(header?.match(/expire=(\d+)/)?.[1] ?? '0', 10),
    };
}
