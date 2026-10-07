import { repoRoot } from "./repo-root.ts";

/** 单条商店腿：Google Play 或 App Store Connect。 */
export type StorePlatform = "android" | "ios";
/** 命令行 `os=` 的取值；`all` 一次发全部商店。 */
export type StoreTarget = StorePlatform | "all";

export interface StoreBuildRequest {
  target: StoreTarget;
  dryRun: boolean;
}

/**
 * 本次要发的商店腿。顺序即执行顺序：Android 在前，它的 Gradle 打包一结束就能开始
 * 上传 AAB，而那段上传恰好与 Apple 的第一次归档重叠。
 */
export function requestedPlatforms(
  target: StoreTarget,
): readonly StorePlatform[] {
  return target === "all" ? ["android", "ios"] : [target];
}

export interface AndroidConfig {
  packageName: string;
  track: string;
  aab: string;
  mapping: string;
}

export interface AppleConfig {
  scheme: string;
  bundleId: string;
  teamId: string;
  signingCertificate: string;
  project: string;
  archive: string;
  exportOptions: string;
  exportDir: string;
  ipa: string;
}

export interface StoreConfig {
  android: AndroidConfig;
  ios: AppleConfig;
}

export interface StoreEnv extends AndroidSigningEnv {
  storeProxy: string;
  androidTrack?: string;
  playServiceAccountJson: string;
  appStoreKeyId: string;
  appStoreIssuerId: string;
  appStoreKeyPath: string;
  iosTestflightGroup: string;
}

const USAGE =
  "用法: make sync-store-build os=android|ios|all [dry_run=1]" +
  "（os=all 一次发两个商店，build 号只算一次）";

function isTarget(value: string): value is StoreTarget {
  return value === "android" || value === "ios" || value === "all";
}

export function parseStoreBuildArgs(
  argv: readonly string[],
): StoreBuildRequest {
  let os = "";
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--os") os = argv[++i] ?? "";
    else if (arg === "--dry-run") dryRun = true;
    else throw new Error(`unknown argument: ${arg}\n${USAGE}`);
  }
  if (!isTarget(os)) {
    throw new Error(`os 必须显式指定 android|ios|all\n${USAGE}`);
  }
  return { target: os, dryRun };
}

export function parseDotEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return values;
}

function required(values: Record<string, string>, key: string): string {
  const value = values[key];
  if (value === undefined || value === "") throw new Error(`.env 缺 ${key}=`);
  return value;
}

/** 上传密钥的 keystore；商店腿用它签交给 Play 的 AAB（Play 再用应用签名密钥重签下发）。 */
export interface AndroidSigningEnv {
  androidKeystoreFile: string;
  androidKeystorePassword: string;
  androidKeyAlias: string;
  androidKeyPassword: string;
}

function readAndroidSigning(values: Record<string, string>): AndroidSigningEnv {
  return {
    androidKeystoreFile: required(values, "android_keystore_file"),
    androidKeystorePassword: required(values, "android_keystore_password"),
    androidKeyAlias: required(values, "android_key_alias"),
    androidKeyPassword: required(values, "android_key_password"),
  };
}

export function readStoreEnv(path = `${repoRoot}/.env`): StoreEnv {
  const values = parseDotEnv(Deno.readTextFileSync(path));
  return {
    storeProxy: required(values, "store_proxy"),
    androidTrack: values.android_store_track,
    playServiceAccountJson: required(values, "play_service_account_json"),
    ...readAndroidSigning(values),
    appStoreKeyId: required(values, "app_store_key_id"),
    appStoreIssuerId: required(values, "app_store_issuer_id"),
    appStoreKeyPath: required(values, "app_store_key_path"),
    iosTestflightGroup: required(values, "ios_testflight_group"),
  };
}

function parseSectionedToml(
  text: string,
): Record<string, Record<string, string>> {
  const sections: Record<string, Record<string, string>> = {};
  let current = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const section = /^\[([a-z]+)\]$/.exec(line);
    if (section !== null) {
      current = section[1];
      sections[current] = {};
      continue;
    }
    const match = /^([A-Za-z_]+)\s*=\s*"([^"]*)"$/.exec(line);
    if (match === null || current === "") continue;
    sections[current][match[1]] = match[2];
  }
  return sections;
}

function requireConfig(
  section: Record<string, string> | undefined,
  key: string,
  table: string,
): string {
  const value = section?.[key];
  if (value === undefined || value === "") {
    throw new Error(`store-build.toml 缺 ${table}.${key}`);
  }
  return value;
}

function readAppleConfig(
  section: Record<string, string> | undefined,
): AppleConfig {
  const read = (key: string) => requireConfig(section, key, "ios");
  return {
    scheme: read("scheme"),
    bundleId: read("bundle_id"),
    teamId: read("team_id"),
    signingCertificate: read("signing_certificate"),
    project: read("project"),
    archive: read("archive"),
    exportOptions: read("export_options"),
    exportDir: read("export_dir"),
    ipa: read("ipa"),
  };
}

export function readStoreConfig(
  path = `${repoRoot}/store-build.toml`,
  env?: StoreEnv,
): StoreConfig {
  const raw = parseSectionedToml(Deno.readTextFileSync(path));
  const android = raw.android;
  return {
    android: {
      packageName: requireConfig(android, "package", "android"),
      track: env?.androidTrack ?? requireConfig(android, "track", "android"),
      aab: requireConfig(android, "aab", "android"),
      mapping: requireConfig(android, "mapping", "android"),
    },
    ios: readAppleConfig(raw.ios),
  };
}
