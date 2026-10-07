// 收尾报告：一次商店构建结束时（成功或失败）打出的唯一汇总。
//
// WHY：整轮跑十几分钟、输出上万行，而人真正要知道的只有四件事——哪些阶段跑了多久、
// 交付物多大、哪一步炸了、去哪看全量输出。这四件事散在滚过去的日志里，失败时
// 尤其难拼：并发的两端交织，真正的错误离最后一行有十分钟远。
//
// 纯格式化，不碰文件系统：报告的形状要能被单测钉住。

import type { StageRecord } from "./progress.ts";

export interface ArtifactRecord {
  label: string;
  /** 仓根相对路径，与 store-build.toml 一致。 */
  path: string;
  bytes: number;
}

export interface FailureDetail {
  stage: string;
  reason: string;
  /** 该阶段的日志路径；纯 API 的阶段不起子进程，没有日志，此时为空字符串。 */
  logFile: string;
  /** 该阶段日志的尾部若干行；同上，无日志时为空字符串。 */
  tail: string;
}

export interface StoreReport {
  target: string;
  buildNumber: number;
  /** dry-run 的报告与真发布长得一模一样，不写明就分不出这轮到底有没有上传。 */
  dryRun: boolean;
  stages: readonly StageRecord[];
  artifacts: readonly ArtifactRecord[];
  failures: readonly FailureDetail[];
  wallClockMs: number;
  logDir: string;
}

const RULE = "─".repeat(72);

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/** 秒以下不体现：本管线里没有一个阶段快到需要毫秒。 */
export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m${pad(seconds % 60, 2)}s`;
  return `${Math.floor(minutes / 60)}h${pad(minutes % 60, 2)}m`;
}

const UNITS = ["B", "KiB", "MiB", "GiB"] as const;

/** 二进制单位并写明 KiB/MiB：商店与 altool 报的都是字节，换算口径不能含糊。 */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${bytes} ${UNITS[0]}` : `${value.toFixed(1)} ${UNITS[unit]}`;
}

function widestOf(values: readonly string[]): number {
  return values.reduce((widest, value) => Math.max(widest, value.length), 0);
}

function stageLines(stages: readonly StageRecord[]): string[] {
  const width = widestOf(stages.map((stage) => stage.name));
  return stages.map((stage) =>
    `  ${stage.ok ? "✔" : "✖"} ${stage.name.padEnd(width)}  ${
      formatDuration(stage.elapsedMs)
    }`
  );
}

/** 合计行与明细同表对齐：分开算宽度就会错位，而错位的表没人愿意读。 */
function artifactLines(artifacts: readonly ArtifactRecord[]): string[] {
  if (artifacts.length === 0) return [];
  const totalBytes = artifacts.reduce((total, one) => total + one.bytes, 0);
  const rows = [
    ...artifacts.map((artifact) => ({
      label: artifact.label,
      size: formatBytes(artifact.bytes),
      note: artifact.path,
    })),
    {
      label: "total",
      size: formatBytes(totalBytes),
      note: `${artifacts.length} files`,
    },
  ];
  const labelWidth = widestOf(rows.map((row) => row.label));
  const sizeWidth = widestOf(rows.map((row) => row.size));
  return rows.map((row) =>
    `    ${row.label.padEnd(labelWidth)}  ${
      row.size.padStart(sizeWidth)
    }  ${row.note}`
  );
}

/**
 * 子进程的失败原因里已经带着日志路径（错误本身要能自证去哪看），此时不再单列一行——
 * 同一条路径连打两遍，读的人会以为那是两个不同的文件。
 */
function failureLines(failures: readonly FailureDetail[]): string[] {
  return failures.flatMap((failure) => [
    `    ${failure.stage}: ${failure.reason}`,
    ...(failure.logFile === "" || failure.reason.includes(failure.logFile)
      ? []
      : [`    full output: ${failure.logFile}`]),
    ...(failure.tail === ""
      ? []
      : failure.tail.split("\n").map((line) => `      ${line}`)),
    "",
  ]);
}

function section(title: string, lines: readonly string[]): string[] {
  return lines.length === 0 ? [] : [`  ${title}`, ...lines];
}

export function formatStoreReport(report: StoreReport): string {
  return [
    "",
    RULE,
    `  store build ${report.failures.length === 0 ? "SUCCEEDED" : "FAILED"} ` +
    `— os=${report.target} build=${report.buildNumber}` +
    (report.dryRun ? " (dry-run: nothing uploaded)" : ""),
    RULE,
    ...section("stages", stageLines(report.stages)),
    ...section("artifacts", artifactLines(report.artifacts)),
    ...section("failures", failureLines(report.failures)),
    `  wall clock ${formatDuration(report.wallClockMs)}`,
    `  logs ${report.logDir}`,
    RULE,
    "",
  ].join("\n");
}
