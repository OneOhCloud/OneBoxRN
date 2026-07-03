/**
 * 开发者工具里 import-flow 测试套件的串行 runner。
 *
 * 本套件不接入 `make test` / CI —— 它纯粹是暴露在开发者屏上的手动诊断。
 * 它唯一的职责，是在用户经由真实 QR 扫描器碰上之前，先抓出
 * "导入入口路径在本设备上会失败"。
 *
 * 设计要点：
 *   - 串行运行用例。若干用例依赖 wall-clock 计时（timeout 竞速），
 *     并行执行会让失败模式更难读。
 *   - 从不触碰真实的 KV / ProfileStore / ExpoOneBox。context 只暴露
 *     fake 与纯 helper。
 *   - 每次转移都输出带 `[ImportTest]` 标签的 jsLog 行，使日志页与面板镜像。
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
    /** 非通过结果的简短可读原因。 */
    message: string | null;
    /** 有则给出完整 stack —— 在展开的行里显示。 */
    stack: string | null;
    /** 每个用例的 `ctx.log(...)` 调用，供 copy-report 按钮使用。 */
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
 * 工厂 —— 每个用例一个全新 context，保证零跨测试状态。
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
 * 按声明顺序运行所有用例。`onUpdate` 在每次状态转移
 * （`pending → running → pass|fail|error`）时触发，好让 UI 渲染实时进度。
 * 返回最终快照。
 *
 * `fail` 与 `error` 的区别：抛出 `AssertionError`（或我们的 `TestFailure`）
 * 算 `fail`；其它任何抛出算 `error`。区别在于 UX —— 面板里一个红标、一个琥珀标。
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
 * 标记子类 —— 由 `expect*` helper 抛出。其它任何逃逸出测试体的抛出都归为
 * `error`（意外），而非 `fail`（断言）。两者都会让整轮无法变绿，但 UX 与
 * 排查路径不同。
 */
export class TestFailure extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'TestFailure';
    }
}

// ─── 断言 ──────────────────────────────────────────────────────────────

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

// ─── Report 序列化 ────────────────────────────────────────────────────

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
