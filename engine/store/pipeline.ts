// 商店发布的编排层：每条腿拆成「构建」与「投递」两个阶段，两条腿并行，失败聚合。

import type { StoreProgress } from "./progress.ts";

/**
 * 阶段名的唯一构造点。腿的两半各自成阶段，而阶段名同时决定日志文件名——腿的实现要
 * 拿到自己那一半的日志路径，两边各拼一次字符串就必然漂移。
 */
export function buildStageName(leg: string): string {
  return `${leg}-build`;
}

export function deliverStageName(leg: string): string {
  return `${leg}-deliver`;
}

/** 一条商店腿：CPU 密集的构建，与网络密集的投递。 */
export interface StoreLeg {
  /** 出现在日志与失败聚合里的名字：`android` / `ios`。 */
  name: string;
  build(): Promise<void>;
  deliver(): Promise<void>;
}

interface LegOutcome {
  name: string;
  error?: unknown;
}

/**
 * 立刻挂上收集器。并行跑着的那一半会在别处还没 await 时就可能失败，那就成了
 * unhandled rejection：进程被带走，而失败原因不属于任何一端、也不进聚合。
 */
function track(name: string, work: Promise<void>): Promise<LegOutcome> {
  return work.then(() => ({ name }), (error) => ({ name, error }));
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 等齐全部并行工作，失败一律聚合后抛出——一条腿的失败不能被另一条的成功淹没。
 */
export async function settleAll(
  entries: readonly { name: string; work: Promise<void> }[],
): Promise<void> {
  const outcomes = await Promise.all(
    entries.map((entry) => track(entry.name, entry.work)),
  );
  throwAggregate(outcomes.filter((outcome) => outcome.error !== undefined));
}

function throwAggregate(failures: readonly LegOutcome[]): void {
  if (failures.length === 0) return;
  throw new Error(
    failures
      .map((outcome) => `[store] ${outcome.name} failed: ${reason(outcome.error)}`)
      .join("\n"),
  );
}

/** 先构建后投递，两半各成一个阶段；构建失败即不投递。 */
export async function runLeg(
  leg: StoreLeg,
  progress: StoreProgress,
): Promise<void> {
  await progress.stage(buildStageName(leg.name), () => leg.build());
  await progress.stage(deliverStageName(leg.name), () => leg.deliver());
}
