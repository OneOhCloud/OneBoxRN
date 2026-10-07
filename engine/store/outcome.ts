// 报告的取数层：从磁盘与阶段记账里取出交付物大小与失败摘要。
//
// 与 report.ts 分开是为了让格式化保持纯函数（可单测钉住形状），这里只负责「去哪拿」。

import { fileExists } from "./proc.ts";
import { repoRoot } from "./repo-root.ts";
import type { StoreConfig, StorePlatform } from "./config.ts";
import type { StageRecord } from "./progress.ts";
import type { ArtifactRecord, FailureDetail } from "./report.ts";
import { lastLines, readLogTail, type RunLog } from "./run-log.ts";

/** 失败摘要保留的尾部行数：编译器与 xcodebuild 的真正错误都落在最后这一小段里。 */
const FAILURE_TAIL_LINES = 24;

export interface ArtifactTarget {
  label: string;
  /** 仓根相对路径，与 store-build.toml 一致。 */
  path: string;
}

/**
 * 本次要交给商店的全部文件。Play 收三个（安装包、R8 映射、native 符号），App Store
 * 收一个 .ipa——三个 Android 文件都要上传，只报安装包大小会瞒掉另外两次传输。
 */
export function artifactTargets(
  config: StoreConfig,
  platforms: readonly StorePlatform[],
): readonly ArtifactTarget[] {
  const targets: ArtifactTarget[] = [];
  if (platforms.includes("android")) {
    targets.push(
      { label: "android aab", path: config.android.aab },
      { label: "android mapping", path: config.android.mapping },
    );
  }
  if (platforms.includes("ios")) {
    targets.push({ label: "ios ipa", path: config.ios.ipa });
  }
  return targets;
}

/** 文件不存在时返回 null：那条腿失败了本就没有产物，不是错误。 */
function fileSize(path: string): number | null {
  try {
    return Deno.statSync(path).size;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}

export function collectArtifacts(
  config: StoreConfig,
  platforms: readonly StorePlatform[],
): ArtifactRecord[] {
  return artifactTargets(config, platforms).flatMap((target) => {
    const bytes = fileSize(`${repoRoot}/${target.path}`);
    return bytes === null ? [] : [{ ...target, bytes }];
  });
}

/**
 * 投递阶段（Play API、App Store Connect）不起子进程，没有日志文件。指向一个不存在的
 * 路径比不指更糟——那是在让人白跑一趟，故此时留空，报告据此不打那一行。
 */
export function collectFailures(
  stages: readonly StageRecord[],
  runLog: RunLog,
): FailureDetail[] {
  return stages.filter((stage) => !stage.ok).map((stage) => {
    const path = runLog.pathFor(stage.name);
    const logged = fileExists(path);
    return {
      stage: stage.name,
      reason: stage.reason,
      logFile: logged ? path : "",
      tail: logged ? lastLines(readLogTail(path), FAILURE_TAIL_LINES) : "",
    };
  });
}
