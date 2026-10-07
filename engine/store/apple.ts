import type { Exec } from "./proc.ts";
import { repoRoot } from "./repo-root.ts";
import type { AppleConfig, StoreBuildRequest, StoreEnv } from "./config.ts";
import { requestJson, sleep } from "./http.ts";
import { appStoreConnectJwt } from "./jwt.ts";
import {
  buildStageName,
  deliverStageName,
  type StoreLeg,
} from "./pipeline.ts";
import { type RunLog, withLogFile } from "./run-log.ts";

const PROCESSING_TIMEOUT_MS = 30 * 60_000;
const ASC_API = "https://api.appstoreconnect.apple.com/v1";

/** 腿名同时是阶段名与日志文件名的词根，故只在这里写一次。 */
const IOS_LEG = "ios";

/** Xcode 的平台名：既是归档 destination 的一部分，也是 `-showdestinations` 清单里的键。 */
export const ARCHIVE_PLATFORM = "iOS";
const ARCHIVE_DESTINATION = `generic/platform=${ARCHIVE_PLATFORM}`;

interface TestFlightGroup {
  id: string;
  name: string;
  isInternalGroup: boolean;
}

/**
 * 每次请求现签 token：调用方拿不到、也无从持有一个会过期的 jwt，故轮询跑多久都不会
 * 中途 401（见 jwt.ts 的 ASC_JWT_LIFETIME_SECONDS）。签发是本地纯计算，复用省不下什么。
 */
async function ascJson(
  path: string,
  env: StoreEnv,
  init: RequestInit = {},
): Promise<unknown> {
  const jwt = await appStoreConnectJwt(env);
  return await requestJson(`ASC ${path}`, `${ASC_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

function firstId(json: unknown, description: string): string {
  const data = (json as { data?: Array<{ id?: unknown }> }).data;
  const id = data?.[0]?.id;
  if (typeof id !== "string" || id === "") {
    throw new Error(`App Store Connect returned no ${description}`);
  }
  return id;
}

export function selectTestFlightGroup(
  json: unknown,
  groupName: string,
): TestFlightGroup {
  const groups = (json as {
    data?: Array<{
      id?: unknown;
      attributes?: { name?: unknown; isInternalGroup?: unknown };
    }>;
  }).data ?? [];
  const group = groups.find((candidate) =>
    candidate.attributes?.name === groupName
  );
  if (typeof group?.id === "string") {
    return {
      id: group.id,
      name: groupName,
      isInternalGroup: group.attributes?.isInternalGroup === true,
    };
  }

  const available = groups
    .map((candidate) => candidate.attributes?.name)
    .filter((name): name is string => typeof name === "string" && name !== "")
    .join(", ");
  throw new Error(
    `App Store Connect returned no TestFlight group ${groupName}` +
      (available === "" ? "" : `. Available groups: ${available}`),
  );
}

export function selectProcessedBuildId(
  json: unknown,
  buildNumber: number,
): { id: string; state: string } | undefined {
  const builds = (json as {
    data?: Array<{
      id?: unknown;
      attributes?: { processingState?: unknown; version?: unknown };
    }>;
  }).data ?? [];
  const build = builds.find((candidate) =>
    candidate.attributes?.version === String(buildNumber)
  );
  if (typeof build?.id !== "string") return undefined;
  const state = typeof build.attributes?.processingState === "string"
    ? build.attributes.processingState
    : "UNKNOWN";
  return { id: build.id, state };
}

async function appStoreAppId(bundleId: string, env: StoreEnv): Promise<string> {
  return firstId(
    await ascJson(
      `/apps?filter[bundleId]=${encodeURIComponent(bundleId)}`,
      env,
    ),
    `app for bundle id ${bundleId}`,
  );
}

async function betaGroupId(
  appId: string,
  env: StoreEnv,
): Promise<TestFlightGroup> {
  return selectTestFlightGroup(
    await ascJson(
      `/betaGroups?filter[app]=${encodeURIComponent(appId)}&limit=200`,
      env,
    ),
    env.iosTestflightGroup,
  );
}

export interface ProcessedBuildQuery {
  appId: string;
  buildNumber: number;
}

export function processedBuildsPath(query: ProcessedBuildQuery): string {
  return `/builds?filter[app]=${encodeURIComponent(query.appId)}` +
    `&filter[version]=${query.buildNumber}&limit=200`;
}

async function waitForProcessedBuild(
  query: ProcessedBuildQuery,
  env: StoreEnv,
): Promise<string> {
  const buildNumber = query.buildNumber;
  const started = Date.now();
  while (Date.now() - started < PROCESSING_TIMEOUT_MS) {
    const json = await ascJson(processedBuildsPath(query), env);
    const build = selectProcessedBuildId(json, buildNumber);
    if (build?.state === "VALID") return build.id;
    if (build?.state === "FAILED" || build?.state === "INVALID") {
      throw new Error(
        `App Store Connect processing failed for build ${buildNumber}`,
      );
    }
    console.log(
      `[store] App Store Connect processing build ${buildNumber}: state ${
        build?.state ?? "not visible yet"
      } (${Math.round((Date.now() - started) / 1000)}s elapsed)`,
    );
    await sleep(30_000);
  }
  throw new Error(
    `App Store Connect processing timed out after ${PROCESSING_TIMEOUT_MS}ms for build ${buildNumber}`,
  );
}

async function assignBuildToBetaGroup(
  buildId: string,
  groupId: string,
  env: StoreEnv,
): Promise<void> {
  await ascJson(`/betaGroups/${groupId}/relationships/builds`, env, {
    method: "POST",
    body: JSON.stringify({ data: [{ type: "builds", id: buildId }] }),
  });
}

export function altoolUploadArgs(config: AppleConfig, env: StoreEnv): string[] {
  return [
    "altool",
    "--upload-app",
    "-f",
    config.ipa,
    "--type",
    "ios",
    "--apiKey",
    env.appStoreKeyId,
    "--apiIssuer",
    env.appStoreIssuerId,
    "--p8-file-path",
    env.appStoreKeyPath,
  ];
}

function xcodeAuthenticationArgs(env: StoreEnv): string[] {
  return [
    "-authenticationKeyPath",
    env.appStoreKeyPath,
    "-authenticationKeyID",
    env.appStoreKeyId,
    "-authenticationKeyIssuerID",
    env.appStoreIssuerId,
  ];
}

export function xcodeArchiveArgs(config: AppleConfig, env: StoreEnv): string[] {
  return [
    "archive",
    "-project",
    config.project,
    "-scheme",
    config.scheme,
    "-configuration",
    "Release",
    "-destination",
    ARCHIVE_DESTINATION,
    "-archivePath",
    config.archive,
    "-allowProvisioningUpdates",
    ...xcodeAuthenticationArgs(env),
    "CODE_SIGN_STYLE=Automatic",
    `DEVELOPMENT_TEAM=${config.teamId}`,
  ];
}

/**
 * 导出必须带认证参数，且那把 key 必须是 **Admin**。
 *
 * 归档是自动签名，签名资产由 `-allowProvisioningUpdates` 现建，而现建要跟 Apple
 * 通信。命令行下唯一可用的身份就是这把 key：`xcodebuild` 读不到 Xcode.app 里登录的账号
 * （`IDEProvisioningTeams` 为空、无 `IDEAccountUserData`，报 `No Accounts`——即便
 * Xcode 里那个账号是 Admin、即便从图形登录会话的终端跑）。
 *
 * key 的角色不足时报 `Cloud signing permission error`（同一把 key 直接 `POST /v1/profiles`
 * 也是 403 FORBIDDEN，两处是同一个权限）。
 */
export function xcodeExportArchiveArgs(
  config: AppleConfig,
  env: StoreEnv,
): string[] {
  return [
    "-exportArchive",
    "-archivePath",
    config.archive,
    "-exportOptionsPlist",
    config.exportOptions,
    "-exportPath",
    config.exportDir,
    "-allowProvisioningUpdates",
    ...xcodeAuthenticationArgs(env),
  ];
}

const EXPORT_RECOVERY_STEPS = [
  "- 发布描述文件由 -allowProvisioningUpdates 现建，用的是 .env 那把 App Store Connect API key 的权限",
  "- 报 “Cloud signing permission error” 或 “No profiles for … were found”：那把 key 的角色不是 Admin。去 App Store Connect → 用户和访问 → 集成 → App Store Connect API 另建一把 Admin 的 key，改 .env 的 app_store_key_id / issuer / path",
  "- 报 “No Accounts”：说明这次没传 key。xcodebuild 读不到 Xcode.app 里登录的账号（哪怕它是 Admin），命令行只认 key",
];

export function appleExportFailureMessage(
  error: unknown,
  config: AppleConfig,
): string {
  const original = error instanceof Error ? error.message : String(error);
  return [
    original,
    "",
    "iOS export 失败时请先核对 App Store 签名材料：",
    `- 团队必须是 ${config.teamId}`,
    `- 证书必须包含 ${config.signingCertificate}: OneOh Cloud LLC (${config.teamId})`,
    `- 主 app bundle id: ${config.bundleId}`,
    `- 扩展 bundle id: ${config.bundleId}.tunnel 与 ${config.bundleId}.control`,
    ...EXPORT_RECOVERY_STEPS,
  ].join("\n");
}

interface ApplePublication {
  request: StoreBuildRequest;
  config: AppleConfig;
  env: StoreEnv;
  buildNumber: number;
}

/** CPU 密集的一半：归档 → 导出成品。 */
async function archiveAndExportApple(
  publication: ApplePublication,
  exec: Exec,
): Promise<void> {
  const { config, env, buildNumber } = publication;
  console.log(`[store] ios archiving build ${buildNumber}`);
  await exec("xcodebuild", xcodeArchiveArgs(config, env), { cwd: repoRoot });
  try {
    await exec("xcodebuild", xcodeExportArchiveArgs(config, env), {
      cwd: repoRoot,
      timeoutMs: PROCESSING_TIMEOUT_MS,
    });
  } catch (error) {
    throw new Error(appleExportFailureMessage(error, config));
  }
}

/** 网络密集的一半：上传 → 解析投递目标 →（仅外部组）等 processing → 分配。 */
async function deliverApple(
  publication: ApplePublication,
  exec: Exec,
): Promise<void> {
  const { request, config, env, buildNumber } = publication;
  if (request.dryRun) {
    console.log(
      `[store] dry-run ios: would upload ${config.ipa} and assign group ${env.iosTestflightGroup}`,
    );
    return;
  }
  await exec("xcrun", altoolUploadArgs(config, env), {
    timeoutMs: PROCESSING_TIMEOUT_MS,
  });
  const appId = await appStoreAppId(config.bundleId, env);
  const group = await betaGroupId(appId, env);
  // 内部组对本 app 的全部 build 天然有权，不需要 buildId。判定必须先于轮询：反过来
  // 写就是为一个用不到的 id 白等一轮 processing（上限 30 分钟），而那正是本命令
  // 墙钟里最长的一段。
  if (group.isInternalGroup) {
    console.log(
      `[store] ios uploaded build=${buildNumber}; internal TestFlight group ${group.name} has access without explicit assignment`,
    );
    return;
  }
  const buildId = await waitForProcessedBuild({ appId, buildNumber }, env);
  await assignBuildToBetaGroup(buildId, group.id, env);
  console.log(
    `[store] ios uploaded build=${buildNumber} and assigned TestFlight group ${env.iosTestflightGroup}`,
  );
}

/**
 * iOS 腿交给流水线编排：导出完即开始上传。
 *
 * 引擎产物与外链注入不在此处：由 store-build.ts 在全部腿之前备一次。
 */
export function iosLeg(
  request: StoreBuildRequest,
  config: AppleConfig,
  env: StoreEnv,
  exec: Exec,
  buildNumber: number,
  runLog: RunLog,
): StoreLeg {
  const publication = { request, config, env, buildNumber };
  return {
    name: IOS_LEG,
    build: () =>
      archiveAndExportApple(
        publication,
        withLogFile(exec, runLog.pathFor(buildStageName(IOS_LEG))),
      ),
    deliver: () =>
      deliverApple(
        publication,
        withLogFile(exec, runLog.pathFor(deliverStageName(IOS_LEG))),
      ),
  };
}
