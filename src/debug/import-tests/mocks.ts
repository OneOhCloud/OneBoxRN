/**
 * Test doubles for the import-flow suite.
 *
 * Nothing here reaches the real `ExpoOneBox` module, the real
 * `ProfileStore`, or the real network. The entire fake-VPN surface is
 * built around `start()` / `stop()` because those are the only methods
 * the apply path actually awaits — extending it later (e.g. status
 * events) should stay constrained to this file so production code is
 * never tempted to branch on "am I in a test".
 */

export type StartBehavior =
    | { kind: 'resolve' }
    | { kind: 'reject'; message: string }
    /**
     * `hang` never resolves or rejects on its own — callers must race it
     * against a timeout (mirroring the production `ExpoOneBox.start()`
     * timeout race in `src/app/config/index.tsx`).
     */
    | { kind: 'hang' };

export interface FakeVpnModule {
    /** Mutable so individual cases can swap the behaviour mid-run. */
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
                    // Intentionally un-settling promise. The pattern in the
                    // apply path wraps `start()` in Promise.race with a
                    // timeout — tests mirror that.
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
 * Race helper used by apply-flow cases. Matches the shape of the
 * production `Promise.race` against a timeout, so a regression there
 * will manifest here identically.
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
