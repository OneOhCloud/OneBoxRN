import { repoRoot } from "./repo-root.ts";
import { parseDotEnv } from "./config.ts";

/** 两端版本单一来源的仓内路径。 */
const VERSION_FILES = {
  android: "android/app/version.properties",
  ios: "ios/Version.xcconfig",
} as const;

export interface VersionState {
  versionCode: number;
  versionName: string;
  iosBuildNumber: number;
}

export function readVersionState(): VersionState {
  const properties = parseDotEnv(
    Deno.readTextFileSync(`${repoRoot}/${VERSION_FILES.android}`),
  );
  const versionCode = Number(properties.versionCode);
  const versionName = properties.versionName ?? "";
  const xcconfig = Deno.readTextFileSync(`${repoRoot}/${VERSION_FILES.ios}`);
  const match = xcconfig.match(/^CURRENT_PROJECT_VERSION\s*=\s*(\d+)\s*$/m);
  if (!Number.isInteger(versionCode) || versionCode < 1) {
    throw new Error(
      "android/app/version.properties versionCode must be a positive integer",
    );
  }
  if (versionName === "") {
    throw new Error(
      "android/app/version.properties versionName must be non-empty",
    );
  }
  if (match === null) {
    throw new Error("ios/Version.xcconfig 缺 CURRENT_PROJECT_VERSION");
  }
  return {
    versionCode,
    versionName,
    iosBuildNumber: Number(match[1]),
  };
}

export function nextBuildNumber(
  local: VersionState,
  remoteMax: number,
): number {
  return Math.max(
    local.versionCode,
    local.iosBuildNumber,
    remoteMax,
  ) + 1;
}

// 两端一起写：`make version-check` 要求两端 build 号严格相等，漏写的那一端会让它变红，
// 而把写到了的那一端调下来正好破坏漏掉那一端的单调性。
export function writeBuildNumber(next: number): void {
  const version = readVersionState().versionName;
  Deno.writeTextFileSync(
    `${repoRoot}/${VERSION_FILES.android}`,
    `versionCode=${next}\nversionName=${version}\n`,
  );
  const path = `${repoRoot}/${VERSION_FILES.ios}`;
  const updated = Deno.readTextFileSync(path).replace(
    /^CURRENT_PROJECT_VERSION\s*=.*$/m,
    `CURRENT_PROJECT_VERSION = ${next}`,
  );
  Deno.writeTextFileSync(path, updated);
}

/**
 * 定两端共享构建号并写回版本文件：max(本地两端, 远端已上传) + 1。
 */
export function resolveSharedBuildNumber(
  remoteMax: number,
  usedBy: string,
): number {
  const local = readVersionState();
  const next = nextBuildNumber(local, remoteMax);
  writeBuildNumber(next);
  console.log(
    `[version] build number ${next} shared by ${usedBy} ` +
      `(local ${local.versionCode}, remote ${remoteMax})`,
  );
  return next;
}
