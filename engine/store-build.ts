import { type Exec, execCommand } from "./store/proc.ts";
import { repoRoot } from "./store/repo-root.ts";
import { androidLeg, remoteMaxAndroidVersionCode } from "./store/android.ts";
import { iosLeg } from "./store/apple.ts";
import {
  parseStoreBuildArgs,
  readStoreConfig,
  readStoreEnv,
  requestedPlatforms,
  type StoreBuildRequest,
  type StoreConfig,
  type StoreEnv,
  type StorePlatform,
} from "./store/config.ts";
import { syncEngineArtifacts } from "./store/engine-sync.ts";
import { applyStoreProxy } from "./store/http.ts";
import { runLeg, settleAll, type StoreLeg } from "./store/pipeline.ts";
import { createProgress, type StoreProgress } from "./store/progress.ts";
import { collectArtifacts, collectFailures } from "./store/outcome.ts";
import { assertReadyToBuild } from "./store/preflight.ts";
import { formatStoreReport } from "./store/report.ts";
import { createRunLog, type RunLog, withLogFile } from "./store/run-log.ts";
import { resolveSharedBuildNumber } from "./store/version.ts";

/**
 * build 号先定再编：Play 查询要凭据要网络，放在引擎构建之后失败等于白等一次整核编译。
 *
 * 两条商店腿共用同一个号，且只写一次：各算各写会让每条命令改写对端的版本文件、
 * 作废对端的增量构建状态；真并发跑还是对同两个文件的读-改-写竞态。
 */
async function resolveBuildNumber(
  request: StoreBuildRequest,
  platforms: readonly StorePlatform[],
  config: StoreConfig,
  env: StoreEnv,
): Promise<number> {
  const remoteMax = platforms.includes("android")
    ? await remoteMaxAndroidVersionCode(config.android, env, request.dryRun)
    : 0;
  return resolveSharedBuildNumber(remoteMax, platforms.join(", "));
}

/**
 * 引擎编译之间必须串行：两端共用同一份上游源码工作区（engine/upstream），
 * 每次编译前都会往里覆盖构建入口。
 *
 * iOS 排在前——它后面挂着 Xcode 归档，是 app 侧最长的一段，先出来才有东西
 * 与 Android 的引擎编译重叠。
 */
function engineOrder(
  platforms: readonly StorePlatform[],
): readonly StorePlatform[] {
  return [...platforms].sort((a, b) => (a === "ios" ? -1 : b === "ios" ? 1 : 0));
}

/** 引擎阶段名的唯一构造点：它同时是该阶段的日志文件名。 */
function engineStageName(platform: StorePlatform): string {
  return `engine-${platform}`;
}

/**
 * 每个平台的「引擎已就绪」信号。第 n 个引擎排在第 n-1 个之后（共用上游工作区），但每个
 * 平台一就绪就单独放行，不必等另一端。
 */
function startEngines(
  platforms: readonly StorePlatform[],
  exec: Exec,
  progress: StoreProgress,
  runLog: RunLog,
): Map<StorePlatform, Promise<void>> {
  const ready = new Map<StorePlatform, Promise<void>>();
  let chain: Promise<void> = Promise.resolve();
  for (const platform of engineOrder(platforms)) {
    const stage = engineStageName(platform);
    chain = chain.then(() =>
      progress.stage(
        stage,
        () =>
          syncEngineArtifacts(
            platform,
            withLogFile(exec, runLog.pathFor(stage)),
          ),
      )
    );
    ready.set(platform, chain);
  }
  return ready;
}

function legFor(
  platform: StorePlatform,
  request: StoreBuildRequest,
  config: StoreConfig,
  env: StoreEnv,
  exec: Exec,
  buildNumber: number,
  runLog: RunLog,
): StoreLeg {
  return platform === "android"
    ? androidLeg(request, config.android, env, exec, runLog)
    : iosLeg(request, config.ios, env, exec, buildNumber, runLog);
}

export async function runStoreBuild(
  request: StoreBuildRequest,
  exec: Exec = execCommand,
): Promise<void> {
  const startedAt = new Date();
  const startedMs = performance.now();
  const env = readStoreEnv();
  applyStoreProxy(env.storeProxy);
  const config = readStoreConfig(undefined, env);
  const platforms = requestedPlatforms(request.target);
  const runLog = createRunLog(startedAt);
  const progress = createProgress(runLog.pathFor);
  console.log(
    `[store] os=${request.target} logs=${runLog.dir}`,
  );

  // 起飞前检查排在最前：它挡掉的是「本机环境坏了」，而下一行就开始递增并写回两端的
  // build 号、再往后是十几分钟的编译——那两样都不该为一个几秒就能查出来的问题白付。
  await progress.stage("preflight", async () => {
    assertReadyToBuild(platforms, config, env);
  });

  const buildNumber = await resolveBuildNumber(request, platforms, config, env);
  // 外链注入与引擎无关且瞬时完成，先做掉，免得它出现在任何一条关键路径上。
  if (platforms.includes("ios")) {
    await exec("make", ["links"], {
      cwd: repoRoot,
      logFile: runLog.pathFor("links"),
    });
  }

  // 每端一轨：Android 的引擎编译与 Apple 的 Xcode 归档用的是不冲突的资源，
  // app 侧不必等两端引擎全编完才开工。
  const engines = startEngines(platforms, exec, progress, runLog);
  try {
    await settleAll(platforms.map((platform) => ({
      name: platform,
      work: engines.get(platform)!.then(() =>
        runLeg(
          legFor(platform, request, config, env, exec, buildNumber, runLog),
          progress,
        )
      ),
    })));
  } finally {
    // 失败时更要打：报告里那几行尾部日志正是「真正的错误」，而它离最后一行有十几分钟远。
    console.log(formatStoreReport({
      target: request.target,
      buildNumber,
      dryRun: request.dryRun,
      stages: progress.records(),
      artifacts: collectArtifacts(config, platforms),
      failures: collectFailures(progress.records(), runLog),
      wallClockMs: performance.now() - startedMs,
      logDir: runLog.dir,
    }));
  }
}

if (import.meta.main) {
  try {
    await runStoreBuild(parseStoreBuildArgs(Deno.args));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(2);
  }
}
