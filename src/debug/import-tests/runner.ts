/**
 * Serial runner for the developer-tools import-flow test suite.
 *
 * The suite is not wired to `make test` / CI — it is strictly a manual
 * diagnostic surfaced in the dev screen. Its one-and-only responsibility
 * is to catch "the import entry path would fail on this device" before
 * the user runs into it through the real QR scanner.
 *
 * Design notes:
 *   - Runs cases sequentially. Several cases depend on wall-clock
 *     timings (timeout races) and parallel execution would make failure
 *     modes harder to read.
 *   - Never touches real KV / ProfileStore / ExpoOneBox. The context
 *     only exposes fakes + plain helpers.
 *   - Every transition emits `[ImportTest]`-tagged jsLog lines so the
 *     Logs tab mirrors the panel.
 */
import { jsLog } from '@/utils/log-sink';

import { createFakeVpnModule, type FakeVpnModule } from './mocks';

export type TestStatus = 'pending' | 'running' | 'pass' | 'fail' | 'error';

export type TestGroup = 'smoke' | 'parse' | 'crypto' | 'verify' | 'apply' | 'import';

export interface TestResult {
    id: string;
    name: string;
    group: TestGroup;
    status: TestStatus;
    startedAt: number | null;
    finishedAt: number | null;
    durationMs: number | null;
    /** Short human-readable reason for non-pass outcomes. */
    message: string | null;
    /** Full stack when available — shown in the expanded row. */
    stack: string | null;
    /** Per-case `ctx.log(...)` calls, for the copy-report button. */
    logs: string[];
}

export interface TestContext {
    log(message: string): void;
    fakeVpn: FakeVpnModule;
}

export interface TestCase {
    id: string;
    name: string;
    group: TestGroup;
    run(ctx: TestContext): Promise<void>;
}

/**
 * Factory — a fresh context per case guarantees zero cross-test state.
 */
function createContext(): { ctx: TestContext; collected: string[] } {
    const collected: string[] = [];
    const ctx: TestContext = {
        log(message: string) {
            collected.push(message);
            jsLog.debug(`[ImportTest] ${message}`);
        },
        fakeVpn: createFakeVpnModule({ startBehavior: { kind: 'resolve' } }),
    };
    return { ctx, collected };
}

function pendingResult(c: TestCase): TestResult {
    return {
        id: c.id,
        name: c.name,
        group: c.group,
        status: 'pending',
        startedAt: null,
        finishedAt: null,
        durationMs: null,
        message: null,
        stack: null,
        logs: [],
    };
}

/**
 * Run all cases in declaration order. `onUpdate` fires for every state
 * transition (`pending → running → pass|fail|error`) so the UI can
 * render live progress. Returns the final snapshot.
 *
 * `fail` vs `error`: a thrown `AssertionError` (or our `TestFailure`)
 * is `fail`; any other throw is `error`. The distinction is UX — a red
 * pill vs an amber one in the panel.
 */
export async function runAll(
    cases: readonly TestCase[],
    onUpdate: (result: TestResult, all: TestResult[]) => void,
): Promise<TestResult[]> {
    const results: TestResult[] = cases.map(pendingResult);

    jsLog.info(`[ImportTest] run start, cases=${cases.length}`);

    for (let i = 0; i < cases.length; i++) {
        const c = cases[i];
        const { ctx, collected } = createContext();

        results[i] = {
            ...results[i],
            status: 'running',
            startedAt: Date.now(),
            logs: collected,
        };
        onUpdate(results[i], results);

        try {
            await c.run(ctx);
            const finishedAt = Date.now();
            results[i] = {
                ...results[i],
                status: 'pass',
                finishedAt,
                durationMs: finishedAt - (results[i].startedAt ?? finishedAt),
                logs: collected.slice(),
            };
            jsLog.info(`[ImportTest] ✓ ${c.id} (${results[i].durationMs}ms)`);
        } catch (err) {
            const finishedAt = Date.now();
            const isFailure = err instanceof TestFailure;
            const message = err instanceof Error ? err.message : String(err);
            const stack = err instanceof Error ? err.stack ?? null : null;
            results[i] = {
                ...results[i],
                status: isFailure ? 'fail' : 'error',
                finishedAt,
                durationMs: finishedAt - (results[i].startedAt ?? finishedAt),
                message,
                stack,
                logs: collected.slice(),
            };
            jsLog.warn(`[ImportTest] ${isFailure ? '✗' : '!'} ${c.id}: ${message}`);
        }

        onUpdate(results[i], results);
    }

    const pass = results.filter(r => r.status === 'pass').length;
    const fail = results.filter(r => r.status === 'fail').length;
    const error = results.filter(r => r.status === 'error').length;
    jsLog.info(`[ImportTest] run done, pass=${pass} fail=${fail} error=${error}`);

    return results;
}

/**
 * Marker subclass — thrown by `expect*` helpers. Anything else that
 * escapes a test body is classified as `error` (unexpected) rather than
 * `fail` (assertion). Both block the run from being green, but the UX
 * and triage paths differ.
 */
export class TestFailure extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'TestFailure';
    }
}

// ─── Assertions ──────────────────────────────────────────────────────────────

export function expect(condition: unknown, message: string): asserts condition {
    if (!condition) throw new TestFailure(message);
}

export function expectEqual<T>(actual: T, expected: T, label: string): void {
    if (actual !== expected) {
        throw new TestFailure(
            `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
        );
    }
}

export async function expectThrows(
    fn: () => Promise<unknown>,
    label: string,
    messageIncludes?: string,
): Promise<Error> {
    try {
        await fn();
    } catch (err) {
        if (messageIncludes) {
            const msg = err instanceof Error ? err.message : String(err);
            if (!msg.includes(messageIncludes)) {
                throw new TestFailure(
                    `${label}: threw but message did not contain "${messageIncludes}" — got "${msg}"`,
                );
            }
        }
        return err instanceof Error ? err : new Error(String(err));
    }
    throw new TestFailure(`${label}: expected to throw, but resolved`);
}

// ─── Report serialization ────────────────────────────────────────────────────

type ReportRow = Pick<TestResult, 'id' | 'name' | 'group' | 'status' | 'durationMs' | 'message' | 'logs'> & {
    stack: string | null;
};

export interface Report {
    generatedAt: string;
    summary: { total: number; pass: number; fail: number; error: number; pending: number; durationMs: number };
    results: ReportRow[];
}

export function buildReport(results: readonly TestResult[]): Report {
    const pass = results.filter(r => r.status === 'pass').length;
    const fail = results.filter(r => r.status === 'fail').length;
    const error = results.filter(r => r.status === 'error').length;
    const pending = results.filter(r => r.status === 'pending' || r.status === 'running').length;
    const durationMs = results.reduce((acc, r) => acc + (r.durationMs ?? 0), 0);
    return {
        generatedAt: new Date().toISOString(),
        summary: { total: results.length, pass, fail, error, pending, durationMs },
        results: results.map(r => ({
            id: r.id,
            name: r.name,
            group: r.group,
            status: r.status,
            durationMs: r.durationMs,
            message: r.message,
            stack: r.stack,
            logs: r.logs,
        })),
    };
}
