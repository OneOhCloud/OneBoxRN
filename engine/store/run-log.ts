// 一次商店构建的落盘日志：每个阶段一个文件，控制台只留编排层的进度行。
//
// WHY：整轮里 99% 的行来自子进程（cargo / gradle / xcodebuild / altool），而它们是
// 并发跑的——两端的输出交织在一起，排障时读不了，真正的错误早已滚过去。
// 全量输出必须留下，但不该占着控制台：落到 target/store-logs/<轮次>/<阶段>.log，
// 报告与失败摘要再把路径指回去。

import type { Exec } from "./proc.ts";
import { repoRoot } from "./repo-root.ts";

/** 一次构建的日志目录与各阶段的落盘路径。 */
export interface RunLog {
  dir: string;
  pathFor(stage: string): string;
}

/**
 * 把某个阶段的落盘路径绑进 exec。
 *
 * WHY 绑而不是逐个调用点传：一个阶段里有三四次 exec（归档、校验、导出），漏传一个
 * 就是一段输出漏回控制台——而那正是本模块要消灭的东西，且漏了不会有任何报错。
 */
export function withLogFile(exec: Exec, logFile: string): Exec {
  return (cmd, args, options) => exec(cmd, args, { ...options, logFile });
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/** 秒级时间戳作目录名：一天里跑多轮时，按名字就能认出是哪一轮。 */
export function runDirectoryName(startedAt: Date): string {
  return [
    startedAt.getFullYear(),
    pad(startedAt.getMonth() + 1, 2),
    pad(startedAt.getDate(), 2),
  ].join("") +
    "-" +
    [
      pad(startedAt.getHours(), 2),
      pad(startedAt.getMinutes(), 2),
      pad(startedAt.getSeconds(), 2),
    ].join("");
}

/** 日志根目录：`target/` 已 gitignored，日志不入仓。 */
export function logRootDirectory(): string {
  return `${repoRoot}/target/store-logs`;
}

/** 保留最近几轮。日志是排障用的近期证据而非归档，不设上限就是 target/ 里的慢性膨胀。 */
const KEEP_RUNS = 10;

const RUN_DIRECTORY = /^\d{8}-\d{6}$/;

/**
 * 该删掉的旧轮次。只认本模块自己生成的目录名——自动删除的前提是删除范围绝对确定，
 * 目录名对不上的东西一概不碰。名字即时间戳，故字典序就是时间序。
 */
export function expiredRunDirectories(
  names: readonly string[],
  keep = KEEP_RUNS,
): string[] {
  const runs = names.filter((name) => RUN_DIRECTORY.test(name)).sort();
  return runs.slice(0, Math.max(0, runs.length - keep));
}

function pruneOldRuns(root: string): void {
  const names = [...Deno.readDirSync(root)]
    .filter((entry) => entry.isDirectory)
    .map((entry) => entry.name);
  for (const name of expiredRunDirectories(names)) {
    Deno.removeSync(`${root}/${name}`, { recursive: true });
  }
}

export function createRunLog(startedAt: Date): RunLog {
  const root = logRootDirectory();
  const dir = `${root}/${runDirectoryName(startedAt)}`;
  Deno.mkdirSync(dir, { recursive: true });
  pruneOldRuns(root);
  return { dir, pathFor: (stage) => `${dir}/${stage}.log` };
}

/**
 * 终端只吃干净文本。cargo 与 gradle 的输出带 ANSI 控制序列，原样打到进度行上会把
 * 报告糊成乱码；落盘的那一份保持原样，屏幕上的这一份剥掉。
 */
export function stripAnsi(text: string): string {
  // deno-lint-ignore no-control-regex
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

/** 心跳行只要一行「还在动」的证据，故取最后一条非空行。 */
export function lastNonEmptyLine(text: string): string {
  const lines = stripAnsi(text).split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trimEnd();
    if (line.trim() !== "") return line;
  }
  return "";
}

/** 失败摘要取尾部若干行；空行不占额度，它们挤掉的是真正有内容的那几行。 */
export function lastLines(text: string, count: number): string {
  const lines = stripAnsi(text).split("\n").filter((line) => line.trim() !== "");
  return lines.slice(Math.max(0, lines.length - count)).join("\n");
}

/**
 * 定长窗口是按字节切的，首行必然半截（且可能把一个 UTF-8 字符劈开），故整行丢弃。
 * 窗口里一个换行都没有是例外：那说明整段是同一行的尾巴，丢了就什么都不剩。
 */
function dropPartialFirstLine(text: string): string {
  const firstBreak = text.indexOf("\n");
  return firstBreak < 0 ? text : text.slice(firstBreak + 1);
}

/**
 * 日志尾部字节。文件可能有几百 MB（cargo 全量编译），整读进内存只为看最后几行是浪费，
 * 故从末尾定长窗口读回。
 */
export function readLogTail(path: string, maxBytes = 8192): string {
  let file: Deno.FsFile;
  try {
    file = Deno.openSync(path, { read: true });
  } catch (error) {
    // 阶段刚起、子进程还没写出任何东西时文件尚不存在——那是正常状态，不是错误。
    if (error instanceof Deno.errors.NotFound) return "";
    throw error;
  }
  try {
    const size = file.statSync().size;
    const start = size > maxBytes ? size - maxBytes : 0;
    file.seekSync(start, Deno.SeekMode.Start);
    const buffer = new Uint8Array(size - start);
    let filled = 0;
    while (filled < buffer.length) {
      const read = file.readSync(buffer.subarray(filled));
      if (read === null) break;
      filled += read;
    }
    const text = new TextDecoder().decode(buffer.subarray(0, filled));
    return start === 0 ? text : dropPartialFirstLine(text);
  } finally {
    file.close();
  }
}
