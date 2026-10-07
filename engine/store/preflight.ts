// 起飞前检查：把「本机环境坏了」这一类失败挪到花钱之前。
//
// WHY：本命令最贵的两样东西——递增并写回两端的 build 号、十几分钟的引擎编译与归档——
// 都排在任何环境问题暴露之前，而这一类失败每一条都能在几秒内查出来：
//
//   - `JAVA_HOME` 钉着包管理器的版本目录，一次升级把那个目录删了，gradle 秒死——
//     但那时 build 号已经写进两端版本文件，工作树也脏了。
//   - Xcode 把 iOS 报成「未安装」，`-destination generic/platform=iOS` 找不到目标；
//     这条要等引擎编译完、归档真正开始时才炸，离命令起点十几分钟。
//   - 路由模板资产没落位（gitignored 构建期资产），Android
//     打包跑到 preBuild 才炸。
//
// 每条检查都自带修法：只报「缺什么」而不给「怎么补」，等于把排障原样丢回给下一个人。

import { captureText, fileExists } from "./proc.ts";
import { repoRoot } from "./repo-root.ts";
import { ARCHIVE_PLATFORM } from "./apple.ts";
import type { StoreConfig, StoreEnv, StorePlatform } from "./config.ts";

/** 一条没过的检查：缺什么，以及怎么补。 */
export interface PreflightProblem {
  what: string;
  fix: string;
}

/** 起飞前检查唯一的外部作用面。单测注入假实现，因此不起子进程、不看真文件、不读真环境。 */
export interface PreflightProbe {
  exists(path: string): boolean;
  /** 非零退出即抛，与 proc.ts 同一姿态。 */
  capture(cmd: string, args: readonly string[], cwd?: string): string;
  environment(name: string): string | undefined;
}

export const systemProbe: PreflightProbe = {
  exists: (path) => fileExists(path),
  capture: (cmd, args, cwd) => captureText(cmd, [...args], cwd),
  environment: (name) => Deno.env.get(name),
};

/** 一件必须就位的文件，以及它不在时的补法。 */
export interface RequiredFile {
  label: string;
  path: string;
  fix: string;
}

export function missingFileProblems(
  files: readonly RequiredFile[],
  probe: PreflightProbe,
): PreflightProblem[] {
  return files
    .filter((file) => !probe.exists(file.path))
    .map((file) => ({ what: `${file.label}不存在：${file.path}`, fix: file.fix }));
}

/**
 * JDK 探测。
 *
 * 只有 `JAVA_HOME` 显式设了才验它指的路径：没设时 gradle 会自己找，判据交给
 * `/usr/libexec/java_home`——本命令只在 macOS 上跑（另一半是 xcodebuild）。
 */
export function javaProblem(
  javaHome: string,
  probe: PreflightProbe,
): PreflightProblem | undefined {
  if (javaHome !== "") {
    if (probe.exists(`${javaHome}/bin/java`)) return undefined;
    return {
      what: `JAVA_HOME 指向的 JDK 不存在：${javaHome}`,
      fix:
        "JAVA_HOME 不要钉包管理器的版本目录（一次升级就把它删了），改用与版本号无关的稳定路径：" +
        "`export JAVA_HOME=$(/usr/libexec/java_home -v 21)`",
    };
  }
  try {
    probe.capture("/usr/libexec/java_home", []);
    return undefined;
  } catch {
    return {
      what: "本机没有可用的 JDK（JAVA_HOME 未设，/usr/libexec/java_home 也找不到）",
      fix: "装 JDK 21 后设 `export JAVA_HOME=$(/usr/libexec/java_home -v 21)`",
    };
  }
}

/** `xcodebuild -showdestinations` 的两段输出。 */
export interface DestinationSurvey {
  available: readonly string[];
  /** 平台 → Xcode 自陈的不可用原因；没写原因时为空字符串。 */
  ineligible: ReadonlyMap<string, string>;
}

// 分段标题随 Xcode 版本换过写法：老版是 `Available destinations for the "X" scheme:`，
// 新版是 `Destinations compatible with the "X" scheme:`。两条都认——本仓要跨 Xcode 版本跑，
// 而只认其中一条时，解析器会一条目标都收不到。
const AVAILABLE_HEADINGS = [
  "Available destinations",
  "Destinations compatible with",
];
const AVAILABLE_HEADING = AVAILABLE_HEADINGS[0];
const INELIGIBLE_HEADING = "Ineligible destinations";

export function parseDestinationSurvey(output: string): DestinationSurvey {
  const available = new Set<string>();
  const ineligible = new Map<string, string>();
  let heading = "";
  for (const line of output.split("\n")) {
    if (AVAILABLE_HEADINGS.some((known) => line.includes(known))) {
      heading = AVAILABLE_HEADING;
    } else if (line.includes(INELIGIBLE_HEADING)) heading = INELIGIBLE_HEADING;
    const platform = /platform:([A-Za-z]+)/.exec(line)?.[1];
    if (platform === undefined) continue;
    // 认不出标题时旧写法静默返回空的 available，于是「我没看懂这份输出」被报成
    // 「这台机器没装该平台」，把一台平台齐全的机器挡在起飞前检查外。
    // 读不懂就必须响亮地说读不懂。
    if (heading === "") {
      throw new Error(
        "xcodebuild -showdestinations 列出了目标，却没出现任何已知的分段标题（认得的是 " +
          [...AVAILABLE_HEADINGS, INELIGIBLE_HEADING].join(" / ") +
          "）—— 解析器读不懂本机 Xcode 的输出，此时报「平台没装」是假的",
      );
    }
    if (heading === AVAILABLE_HEADING) available.add(platform);
    // 同一平台会列出多条（真机、占位符），原因相同，留第一条。
    else if (heading === INELIGIBLE_HEADING && !ineligible.has(platform)) {
      ineligible.set(platform, /error:([^}]*)/.exec(line)?.[1].trim() ?? "");
    }
  }
  return { available: [...available], ineligible };
}

/**
 * 平台可用性与本仓的 app 项目无关，故拿 `ios/Core` 那个纯 Swift 包去问：它不依赖引擎
 * 产物，因此在引擎同步之前就答得出来——而「早于引擎编译」正是这道检查存在的理由。
 */
export const DESTINATION_PROBE_PACKAGE = "ios/Core";
export const DESTINATION_PROBE_SCHEME = "Core";

export function surveyDestinations(probe: PreflightProbe): DestinationSurvey {
  return parseDestinationSurvey(probe.capture(
    "xcodebuild",
    ["-showdestinations", "-scheme", DESTINATION_PROBE_SCHEME],
    `${repoRoot}/${DESTINATION_PROBE_PACKAGE}`,
  ));
}

export function archiveDestinationProblem(
  survey: DestinationSurvey,
  platform: string,
): PreflightProblem | undefined {
  if (survey.available.includes(platform)) return undefined;
  const reason = survey.ineligible.get(platform) ?? "";
  return {
    what: `Xcode 没有可用的 ${platform} 归档目标` +
      (reason === "" ? "" : `：${reason}`),
    fix:
      `跑 \`xcodebuild -downloadPlatform ${platform}\`（等价于 Xcode → Settings → Components 里装该平台），` +
      `再用 \`cd ${DESTINATION_PROBE_PACKAGE} && xcodebuild -showdestinations -scheme ${DESTINATION_PROBE_SCHEME}\`` +
      " 确认它回到 Available 段",
  };
}

/** 路由模板：两端各一份，`make templates` 从 .env 的两个 URL 拉取。 */
const TEMPLATE_NAMES = ["tun-rules.json", "tun-global.json"];
const TEMPLATE_DIRECTORIES: Record<StorePlatform, string> = {
  android: "android/app/src/main/assets/templates",
  ios: "ios/App/Templates",
};
const TEMPLATE_FIX =
  "跑 `make templates`（路由模板是 gitignored 的构建期资产，干净检出与新建 worktree 里都没有）";

function templateFiles(platform: StorePlatform): RequiredFile[] {
  return TEMPLATE_NAMES.map((name) => ({
    label: `${platform} 路由模板`,
    path: `${repoRoot}/${TEMPLATE_DIRECTORIES[platform]}/${name}`,
    fix: TEMPLATE_FIX,
  }));
}

function androidFiles(env: StoreEnv): RequiredFile[] {
  return [
    {
      label: "release keystore",
      path: env.androidKeystoreFile,
      fix: "核对 .env 的 android_keystore_file=（本机绝对路径，不入仓）",
    },
    {
      label: "Play service account JSON",
      path: env.playServiceAccountJson,
      fix: "核对 .env 的 play_service_account_json=（本机绝对路径，不入仓）",
    },
  ];
}

function appleFiles(config: StoreConfig, env: StoreEnv): RequiredFile[] {
  return [
    {
      label: "App Store Connect API key",
      path: env.appStoreKeyPath,
      fix: "核对 .env 的 app_store_key_path=（那把 key 必须是 Admin 角色）",
    },
    {
      label: "iOS 导出选项表",
      path: `${repoRoot}/${config.ios.exportOptions}`,
      fix: "该表入仓，缺文件说明检出不完整",
    },
  ];
}

function requiredFiles(
  platform: StorePlatform,
  config: StoreConfig,
  env: StoreEnv,
): RequiredFile[] {
  return [
    ...templateFiles(platform),
    ...(platform === "android" ? androidFiles(env) : appleFiles(config, env)),
  ];
}

export function collectPreflightProblems(
  platforms: readonly StorePlatform[],
  config: StoreConfig,
  env: StoreEnv,
  probe: PreflightProbe,
): PreflightProblem[] {
  const problems = platforms.flatMap((platform) =>
    missingFileProblems(requiredFiles(platform, config, env), probe)
  );
  if (platforms.includes("android")) {
    const java = javaProblem(probe.environment("JAVA_HOME") ?? "", probe);
    if (java !== undefined) problems.push(java);
  }
  if (platforms.includes("ios")) {
    const destination = archiveDestinationProblem(
      surveyDestinations(probe),
      ARCHIVE_PLATFORM,
    );
    if (destination !== undefined) problems.push(destination);
  }
  return problems;
}

export function formatPreflightProblems(
  problems: readonly PreflightProblem[],
): string {
  return [
    `起飞前检查未通过（${problems.length} 项）—— build 号没有递增，也没有开始编译：`,
    ...problems.flatMap((problem, index) => [
      `${index + 1}. ${problem.what}`,
      `   修法：${problem.fix}`,
    ]),
  ].join("\n");
}

/** 一条都不能少：环境坏了就当场停，别让它在十分钟后以别的面目出现。 */
export function assertReadyToBuild(
  platforms: readonly StorePlatform[],
  config: StoreConfig,
  env: StoreEnv,
  probe: PreflightProbe = systemProbe,
): void {
  const problems = collectPreflightProblems(platforms, config, env, probe);
  if (problems.length > 0) throw new Error(formatPreflightProblems(problems));
}
