// 商店构建管线共用的子进程与文件探测层，各模块共用这唯一实现。
// 失败一律抛错，不返回错误码让调用方去判。

export interface ExecOptions {
  cwd?: string;
  /** 只有会打网络的调用才设：本地编译耗时不可预估，给它设上限等于随机杀构建。 */
  timeoutMs?: number;
  /**
   * 设了就把 stdout/stderr 全量追加到该文件，控制台交还给编排层的进度行。
   * 缺省仍是 inherit：单端命令直接跑时，交织问题不存在。
   */
  logFile?: string;
}

/** 取源层唯一的外部作用面。单测注入假实现，因此不打网络也不落真文件。 */
export type Exec = (
  cmd: string,
  args: readonly string[],
  options: ExecOptions,
) => Promise<void>;

function failure(
  cmd: string,
  args: readonly string[],
  code: number,
  logFile?: string,
): Error {
  const summary = `command failed (${code}): ${cmd} ${args.join(" ")}`;
  // 输出落了盘就必须把路径带进错误里：否则「失败了，但输出在哪」要靠人去猜。
  return new Error(
    logFile === undefined ? summary : `${summary} — full output: ${logFile}`,
  );
}

export function run(cmd: string, args: string[], cwd?: string): void {
  const result = new Deno.Command(cmd, {
    args,
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  }).outputSync();
  if (!result.success) throw failure(cmd, args, result.code);
}

export function captureBytes(
  cmd: string,
  args: string[],
  cwd?: string,
): Uint8Array {
  const result = new Deno.Command(cmd, {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).outputSync();
  if (!result.success) {
    const stderr = new TextDecoder().decode(result.stderr);
    throw new Error(
      `${failure(cmd, args, result.code).message}\n${stderr}`,
    );
  }
  return result.stdout;
}

export function captureText(
  cmd: string,
  args: string[],
  cwd?: string,
): string {
  return new TextDecoder().decode(captureBytes(cmd, args, cwd));
}

/**
 * 进程存活探测。用 ps 的退出码而非 `kill -0`：探测对象是别人的构建进程，发信号即便
 * 是空信号也可能改变它的状态（SIGCONT 会唤醒被 SIGSTOP 的进程），而探测不该有副作用。
 */
export function processAlive(pid: number): boolean {
  return new Deno.Command("ps", {
    args: ["-p", String(pid)],
    stdout: "null",
    stderr: "null",
  }).outputSync().success;
}

export function fileExists(path: string): boolean {
  try {
    Deno.statSync(path);
    return true;
  } catch {
    return false;
  }
}

interface ExitStatus {
  success: boolean;
  code: number;
}

type Append = (chunk: Uint8Array) => Promise<void>;

/**
 * 直接写 fd，而不是 `file.writable`：后者要到流关闭才落盘。而进度心跳与失败摘要读的
 * 正是文件的当前内容——「还在动」的证据
 * 必须此刻就在盘上，否则一次十分钟的编译在屏幕上与卡死无从区分。
 *
 * 写入串成一条队列：两条流写同一个文件，并发 write 会把行劈开交错。
 */
function appender(file: Deno.FsFile): Append {
  let queue: Promise<void> = Promise.resolve();
  return (chunk) => {
    queue = queue.then(async () => {
      let written = 0;
      while (written < chunk.length) {
        written += await file.write(chunk.subarray(written));
      }
    });
    return queue;
  };
}

/** 流式转发而非攒在内存：引擎全量编译的输出可达数百 MB。 */
async function drainInto(
  stream: ReadableStream<Uint8Array>,
  append: Append,
): Promise<void> {
  for await (const chunk of stream) await append(chunk);
}

async function runIntoLog(
  command: Deno.Command,
  logFile: string,
): Promise<ExitStatus> {
  const child = command.spawn();
  const file = await Deno.open(logFile, {
    create: true,
    write: true,
    append: true,
  });
  const append = appender(file);
  try {
    await Promise.all([
      drainInto(child.stdout, append),
      drainInto(child.stderr, append),
    ]);
  } finally {
    file.close();
  }
  return await child.status;
}

function timeoutError(
  cmd: string,
  args: readonly string[],
  timeoutMs: number | undefined,
): Error {
  return new Error(
    `command timed out after ${timeoutMs}ms: ${cmd} ${args.join(" ")}`,
  );
}

/**
 * 真实执行器。超时到期即杀进程并抛错——挂死的下载会让 make 永远不返回，比失败更难查。
 */
export const execCommand: Exec = async (cmd, args, options) => {
  const argv = [...args];
  const signal = options.timeoutMs === undefined
    ? undefined
    : AbortSignal.timeout(options.timeoutMs);
  const logFile = options.logFile;
  const command = new Deno.Command(cmd, {
    args: argv,
    cwd: options.cwd,
    stdout: logFile === undefined ? "inherit" : "piped",
    stderr: logFile === undefined ? "inherit" : "piped",
    signal,
  });
  let result: ExitStatus;
  try {
    result = logFile === undefined
      ? await command.output()
      : await runIntoLog(command, logFile);
  } catch (error) {
    if (signal?.aborted) {
      throw timeoutError(cmd, argv, options.timeoutMs);
    }
    throw error;
  }
  if (signal?.aborted) {
    throw timeoutError(cmd, argv, options.timeoutMs);
  }
  if (!result.success) throw failure(cmd, argv, result.code, logFile);
};

export interface CapturedOutput {
  code: number;
  stdout: string;
  stderr: string;
}

export interface CaptureOptions {
  timeoutMs: number;
  /** 追加到继承环境之上；口令走这里而非 argv，`ps` 看得见 argv。 */
  env?: Record<string, string>;
}

/**
 * 非零退出不抛、交给调用方判读：codesign / spctl 靠退出码加 stderr 表态，
 * `aws s3api head-object` 的「不存在」也是非零退出。超时仍抛——挂死与「判为不合法」不是一回事。
 */
export async function captureOutput(
  cmd: string,
  args: readonly string[],
  options: CaptureOptions,
): Promise<CapturedOutput> {
  const signal = AbortSignal.timeout(options.timeoutMs);
  let result: Deno.CommandOutput;
  try {
    result = await new Deno.Command(cmd, {
      args: [...args],
      env: options.env,
      stdout: "piped",
      stderr: "piped",
      signal,
    }).output();
  } catch (error) {
    if (signal.aborted) {
      throw timeoutError(cmd, args, options.timeoutMs);
    }
    throw error;
  }
  if (signal.aborted) {
    throw timeoutError(cmd, args, options.timeoutMs);
  }
  const decoder = new TextDecoder();
  return {
    code: result.code,
    stdout: decoder.decode(result.stdout),
    stderr: decoder.decode(result.stderr),
  };
}
