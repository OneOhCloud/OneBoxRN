import type { Exec } from "./proc.ts";
import { repoRoot } from "./repo-root.ts";
import type { StorePlatform } from "./config.ts";

/** 每条商店腿要的引擎产物由根 Makefile 的哪个 target 落位；与日常构建同一条管线。 */
const ENGINE_TARGETS: Record<StorePlatform, string> = {
  android: "engine-android-release",
  ios: "engine-apple",
};

export function engineSyncArgs(platform: StorePlatform): string[] {
  return [ENGINE_TARGETS[platform]];
}

export async function syncEngineArtifacts(
  platform: StorePlatform,
  exec: Exec,
): Promise<void> {
  await exec("make", engineSyncArgs(platform), { cwd: repoRoot });
}
