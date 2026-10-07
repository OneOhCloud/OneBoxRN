import type { Exec } from "./proc.ts";
import { repoRoot } from "./repo-root.ts";
import type { AndroidConfig, StoreBuildRequest, StoreEnv } from "./config.ts";
import { curlJsonRequest, curlNoJson, requestJson } from "./http.ts";
import { serviceAccountJwt } from "./jwt.ts";
import { buildStageName, type StoreLeg } from "./pipeline.ts";
import { type RunLog, withLogFile } from "./run-log.ts";

type DeobfuscationFileType = "proguard" | "nativeCode";

/** 腿名同时是阶段名与日志文件名的词根，故只在这里写一次。 */
const ANDROID_LEG = "android";

const PLAY_API =
  "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";
const PLAY_UPLOAD_API =
  "https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications";

export function playDeobfuscationUploadUrl(params: {
  packageName: string;
  editId: string;
  apkVersionCode: number;
  fileType: DeobfuscationFileType;
}): string {
  const packageName = encodeURIComponent(params.packageName);
  const editId = encodeURIComponent(params.editId);
  return [
    PLAY_UPLOAD_API,
    packageName,
    "edits",
    editId,
    "apks",
    String(params.apkVersionCode),
    "deobfuscationFiles",
    params.fileType,
  ].join("/") + "?uploadType=media";
}

async function androidAccessToken(
  env: Pick<StoreEnv, "playServiceAccountJson">,
): Promise<string> {
  const credential = JSON.parse(
    Deno.readTextFileSync(env.playServiceAccountJson),
  ) as {
    client_email?: string;
    private_key?: string;
    token_uri?: string;
  };
  if (
    typeof credential.client_email !== "string" ||
    credential.client_email === ""
  ) {
    throw new Error("Play service account JSON has no client_email");
  }
  if (
    typeof credential.private_key !== "string" || credential.private_key === ""
  ) {
    throw new Error("Play service account JSON has no private_key");
  }
  const tokenUri = credential.token_uri ??
    "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);
  const assertion = await serviceAccountJwt({
    clientEmail: credential.client_email,
    privateKeyPem: credential.private_key,
    tokenUri,
    issuedAt: now,
  });
  const json = await requestJson("Google OAuth token request", tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  }) as { access_token?: unknown };
  if (typeof json.access_token !== "string" || json.access_token === "") {
    throw new Error("Google OAuth token response has no access_token");
  }
  return json.access_token;
}

export async function remoteMaxAndroidVersionCode(
  config: Pick<AndroidConfig, "packageName">,
  env: Pick<StoreEnv, "playServiceAccountJson">,
  dryRun: boolean,
): Promise<number> {
  if (dryRun) return 0;
  console.log(
    `[store] reading remote versionCode from Play (${config.packageName})`,
  );
  const token = await androidAccessToken(env);
  const base = `${PLAY_API}/${config.packageName}`;
  const edit = await curlJsonRequest([
    "-X",
    "POST",
    "-H",
    `Authorization: Bearer ${token}`,
    `${base}/edits`,
  ]) as { id?: string };
  if (typeof edit.id !== "string" || edit.id === "") {
    throw new Error("Play edit insert returned no id");
  }
  try {
    const tracks = await curlJsonRequest([
      "-H",
      `Authorization: Bearer ${token}`,
      `${base}/edits/${edit.id}/tracks`,
    ]) as {
      tracks?: Array<
        { releases?: Array<{ versionCodes?: Array<string | number> }> }
      >;
    };
    const versionCodes = (tracks.tracks ?? [])
      .flatMap((track) => track.releases ?? [])
      .flatMap((release) => release.versionCodes ?? [])
      .map((versionCode) => Number(versionCode))
      .filter(Number.isFinite);
    return Math.max(0, ...versionCodes);
  } finally {
    try {
      await curlNoJson([
        "-X",
        "DELETE",
        "-H",
        `Authorization: Bearer ${token}`,
        `${base}/edits/${edit.id}`,
      ]);
    } catch {
      // 读远端 build 号的临时 edit 会自然过期；删除失败不影响后续上传流程。
    }
  }
}

/**
 * Android 腿：CPU 密集的 Gradle 打包，与网络密集的 Play 投递。
 *
 * 外链 URL 由 gradle 配置期直读仓根 .env（缺键在装配期 require 崩溃暴露），无需
 * iOS 那份 xcconfig；引擎产物与 build 号由 store-build.ts 在全部腿之前备一次。
 */
export function androidLeg(
  request: StoreBuildRequest,
  config: AndroidConfig,
  env: StoreEnv,
  exec: Exec,
  runLog: RunLog,
): StoreLeg {
  const buildExec = withLogFile(
    exec,
    runLog.pathFor(buildStageName(ANDROID_LEG)),
  );
  return {
    name: ANDROID_LEG,
    build: () =>
      buildExec("./gradlew", [":app:bundlePlayRelease"], {
        cwd: `${repoRoot}/android`,
      }),
    deliver: () => deliverAndroid(request, config, env),
  };
}

async function deliverAndroid(
  request: StoreBuildRequest,
  config: AndroidConfig,
  env: StoreEnv,
): Promise<void> {
  if (request.dryRun) {
    console.log(
      `[store] dry-run android: would upload ${config.aab}, ${config.mapping} to ${config.track}`,
    );
    return;
  }
  const token = await androidAccessToken(env);
  const base = `${PLAY_API}/${config.packageName}`;
  const uploadBase = `${PLAY_UPLOAD_API}/${config.packageName}`;
  const edit = await curlJsonRequest([
    "-X",
    "POST",
    "-H",
    `Authorization: Bearer ${token}`,
    `${base}/edits`,
  ]) as { id?: string };
  if (typeof edit.id !== "string" || edit.id === "") {
    throw new Error("Play edit insert returned no id");
  }
  console.log(`[store] uploading AAB to Play: ${config.aab}`);
  const bundle = await curlJsonRequest([
    "-X",
    "POST",
    "-H",
    `Authorization: Bearer ${token}`,
    "-H",
    "Content-Type: application/octet-stream",
    "--data-binary",
    `@${config.aab}`,
    `${uploadBase}/edits/${edit.id}/bundles?uploadType=media`,
  ]) as { versionCode?: string | number };
  const uploadedVersionCode = Number(bundle.versionCode);
  if (!Number.isInteger(uploadedVersionCode)) {
    throw new Error("Play bundle upload returned no versionCode");
  }
  console.log(
    `[store] uploading R8 mapping for versionCode ${uploadedVersionCode}`,
  );
  await curlNoJson([
    "-X",
    "POST",
    "-H",
    `Authorization: Bearer ${token}`,
    "-H",
    "Content-Type: application/octet-stream",
    "--data-binary",
    `@${config.mapping}`,
    playDeobfuscationUploadUrl({
      packageName: config.packageName,
      editId: edit.id,
      apkVersionCode: uploadedVersionCode,
      fileType: "proguard",
    }),
  ]);
  console.log(`[store] committing Play edit to track ${config.track}`);
  await curlJsonRequest([
    "-X",
    "PUT",
    "-H",
    `Authorization: Bearer ${token}`,
    "-H",
    "Content-Type: application/json",
    "-d",
    JSON.stringify({
      releases: [{
        versionCodes: [String(uploadedVersionCode)],
        status: "completed",
      }],
    }),
    `${base}/edits/${edit.id}/tracks/${config.track}`,
  ]);
  await curlJsonRequest([
    "-X",
    "POST",
    "-H",
    `Authorization: Bearer ${token}`,
    `${base}/edits/${edit.id}:commit`,
  ]);
  console.log(
    `[store] Android uploaded versionCode=${uploadedVersionCode} to ${config.track}`,
  );
}
