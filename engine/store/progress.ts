// 阶段进度：控制台上唯一持续输出的东西。
//
// 子进程输出全部落盘之后，一次十分钟的引擎编译在屏幕上就没有任何动静了——「还在跑」
// 与「卡死了」看起来一样。心跳补上这条证据：每 30s 一行，带已耗时与该阶段日志的最后
// 一条非空行（cargo 的 Compiling、gradle 的 Task、xcodebuild 的 phase）。

import { fileExists } from "./proc.ts";
import { lastNonEmptyLine, readLogTail } from "./run-log.ts";
import { formatDuration } from "./report.ts";

/** 一个阶段的记账。报告只需要这四样。 */
export interface StageRecord {
  name: string;
  elapsedMs: number;
  ok: boolean;
  /** 失败原因；成功时为空字符串。 */
  reason: string;
}

/** 30s 一跳：既能证明没卡死，又不会把控制台刷成瀑布。 */
const HEARTBEAT_MS = 30_000;

/** 心跳行里的日志摘录上限，超出即截断——进度行必须是一行。 */
const EXCERPT_LIMIT = 96;

export interface StoreProgress {
  /** 计时、记账并打进度行；返回值与异常都原样透传。 */
  stage<T>(name: string, run: () => Promise<T>): Promise<T>;
  records(): readonly StageRecord[];
}

export function excerpt(line: string, limit = EXCERPT_LIMIT): string {
  const trimmed = line.trim();
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit - 1)}…`;
}

function reasonOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0];
}

/**
 * @param logFileFor 阶段名 → 该阶段的落盘日志路径；心跳从那里取「还在动」的证据。
 */
export function createProgress(
  logFileFor: (stage: string) => string,
): StoreProgress {
  const records: StageRecord[] = [];

  async function stage<T>(name: string, run: () => Promise<T>): Promise<T> {
    const started = performance.now();
    console.log(`[store] ▶ ${name}`);
    // 只在日志尾行变了时才带上摘录：链接与代码生成能几分钟不出新行，把同一句重复
    // 打十几遍等于用噪声盖住「哪一跳真的动了」。
    let shown = "";
    const heartbeat = setInterval(() => {
      const line = excerpt(lastNonEmptyLine(readLogTail(logFileFor(name))));
      const fresh = line !== "" && line !== shown;
      shown = line;
      const elapsed = formatDuration(performance.now() - started);
      console.log(`[store] · ${name} ${elapsed}${fresh ? ` | ${line}` : ""}`);
    }, HEARTBEAT_MS);
    try {
      const value = await run();
      records.push({
        name,
        elapsedMs: performance.now() - started,
        ok: true,
        reason: "",
      });
      console.log(
        `[store] ✔ ${name} ${formatDuration(performance.now() - started)}`,
      );
      return value;
    } catch (error) {
      records.push({
        name,
        elapsedMs: performance.now() - started,
        ok: false,
        reason: reasonOf(error),
      });
      // 纯 API 的阶段没有子进程也就没有日志；指向一个不存在的文件是在让人白跑一趟。
      const logFile = logFileFor(name);
      console.log(
        `[store] ✖ ${name} ${formatDuration(performance.now() - started)}${
          fileExists(logFile) ? ` → ${logFile}` : ""
        }`,
      );
      throw error;
    } finally {
      clearInterval(heartbeat);
    }
  }

  return { stage, records: () => records };
}
