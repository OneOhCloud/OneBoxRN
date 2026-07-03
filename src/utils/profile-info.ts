/**
 * 共享的配置文件 userinfo 头解析器。
 * 手动导入屏与后台刷新任务都会用。
 */
export interface ProfileTrafficInfo {
    upload: number;
    download: number;
    total: number;
    expire: number;
}

export function parseProfileUserinfo(header: string | null): ProfileTrafficInfo {
    return {
        upload: parseInt(header?.match(/upload=(\d+)/)?.[1] ?? '0', 10),
        download: parseInt(header?.match(/download=(\d+)/)?.[1] ?? '0', 10),
        total: parseInt(header?.match(/total=(\d+)/)?.[1] ?? '0', 10),
        expire: parseInt(header?.match(/expire=(\d+)/)?.[1] ?? '0', 10),
    };
}
