/**
 * import-flow 套件的测试替身（test doubles）。
 *
 * 这里没有任何东西会触及真实的 `ExpoOneBox` 模块、真实的 `ProfileStore`
 * 或真实网络。整个 fake-VPN 表面都围绕 `start()` / `stop()` 构建，因为它们
 * 是 apply 路径真正 await 的唯一方法 —— 日后扩展（如 status 事件）也应限制
 * 在本文件内，好让生产代码永远不会被诱导去判断"我是否在测试中"。
 */

import type {
    StartOptions,
    StartResult,
    StopOptions,
    StopResult,
} from '@/contexts/vpn/types';

export type StartBehavior =
    | { kind: 'resolve' }
    | { kind: 'reject'; message: string }
    /**
     * `hang` 自身永不 resolve 或 reject —— 调用方必须让它与一个 timeout
     * 竞速（镜像 `src/app/config/index.tsx` 里生产环境 `ExpoOneBox.start()`
     * 的 timeout 竞速）。
     */
    | { kind: 'hang' };

export interface FakeVpnModule {
    /** 可变，好让单个用例在运行中途替换行为。 */
    startBehavior: StartBehavior;
    start(config: string): Promise<void>;
    stop(): Promise<void>;
    readonly callCount: { start: number; stop: number };
    readonly lastConfig: string | null;
}

export function createFakeVpnModule(opts: { startBehavior: StartBehavior }): FakeVpnModule {
    const callCount = { start: 0, stop: 0 };
    let lastConfig: string | null = null;

    const module: FakeVpnModule = {
        startBehavior: opts.startBehavior,
        async start(config: string) {
            callCount.start += 1;
            lastConfig = config;
            const b = module.startBehavior;
            switch (b.kind) {
                case 'resolve':
                    return;
                case 'reject':
                    throw new Error(b.message);
                case 'hang':
                    // 刻意永不 settle 的 promise。apply 路径的做法是把 `start()`
                    // 包进带 timeout 的 Promise.race —— 测试镜像了这一点。
                    await new Promise<never>(() => {});
                    return;
            }
        },
        async stop() {
            callCount.stop += 1;
        },
        get callCount() { return callCount; },
        get lastConfig() { return lastConfig; },
    };

    return module;
}

/**
 * 把 FakeVpnModule 适配成 import-flow 状态机消费的 context-action 结果形状
 * （`useVpn().start/stop` 契约）：返回带类型的结果而非抛出，且具备与
 * `createVpnActions` 相同的 timeout/abort 语义。
 */
export function fakeVpnAsActions(fakeVpn: FakeVpnModule): {
    start(options?: StartOptions): Promise<StartResult>;
    stop(options?: StopOptions): Promise<StopResult>;
} {
    return {
        async start(options?: StartOptions): Promise<StartResult> {
            if (options?.signal?.aborted) return { ok: false, failure: { kind: 'aborted' } };
            const call = fakeVpn.start('{"fake":"config"}');
            try {
                if (options?.timeoutMs !== undefined) {
                    await raceWithTimeout(call, options.timeoutMs, `no result within ${options.timeoutMs}ms`);
                } else {
                    await call;
                }
                return { ok: true };
            } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                if (message.startsWith('no result within')) {
                    return { ok: false, failure: { kind: 'timeout', timeoutMs: options?.timeoutMs ?? 0 } };
                }
                return { ok: false, failure: { kind: 'native-error', message } };
            }
        },
        async stop(): Promise<StopResult> {
            await fakeVpn.stop();
            return { outcome: 'stopped' };
        },
    };
}

/**
 * apply-flow 用例使用的竞速 helper。与生产环境针对 timeout 的 `Promise.race`
 * 形状一致，因此那边一旦回归，这里会以完全相同的方式暴露出来。
 */
export function raceWithTimeout<T>(
    p: Promise<T>,
    timeoutMs: number,
    timeoutMessage: string,
): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    });
    return Promise.race([p, timeoutPromise]).finally(() => {
        if (timeoutId !== null) clearTimeout(timeoutId);
    }) as Promise<T>;
}
