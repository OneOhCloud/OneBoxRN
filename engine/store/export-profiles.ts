// 导出的手工描述文件表与包内实际内嵌的扩展必须一一对应。
//
// WHY：ExportOptions 用 manual 签名（没有 Admin 的 API key，自动签名现建不出发布
// 描述文件）。手工表漏一行不会在任何构建期暴露，只会在一次完整
// 归档之后的导出期报 `No profiles for … were found`——那时已经烧掉几分钟编译和一个 build
// 号。故按 project.pbxproj 的「内嵌扩展」清单反查这张表。
//
// 约定：内嵌扩展 `Foo.appex` 的 bundle id 是 `<主 app bundle id>.<foo>`。不守这条约定的
// target 会让本门禁失败——那正是要它响的时候（表里该有它，而名字推不出来）。

import { repoRoot } from "./repo-root.ts";

const EMBED_PHASE = "Embed Foundation Extensions";

/** 包里内嵌的 app extension 名（不含 `.appex`）。 */
export function embeddedExtensionNames(pbxproj: string): string[] {
  const phase = new RegExp(
    `/\\* ${EMBED_PHASE} \\*/ = \\{[\\s\\S]*?files = \\(([\\s\\S]*?)\\);`,
  ).exec(pbxproj);
  if (phase === null) {
    throw new Error(`project.pbxproj 里找不到 ${EMBED_PHASE} 阶段`);
  }
  return [...phase[1].matchAll(/\w+ \/\* (\w+)\.appex in /g)].map((hit) => hit[1]);
}

/** 要出货的全部 bundle id：主 app 加每个内嵌扩展。 */
export function shippedBundleIds(pbxproj: string, appBundleId: string): string[] {
  return [
    appBundleId,
    ...embeddedExtensionNames(pbxproj).map((name) => `${appBundleId}.${name.toLowerCase()}`),
  ];
}

/** 导出选项里 `provisioningProfiles` 的键集合。 */
export function mappedBundleIds(exportOptions: string): string[] {
  const table = /<key>provisioningProfiles<\/key>\s*<dict>([\s\S]*?)<\/dict>/
    .exec(exportOptions);
  if (table === null) return [];
  return [...table[1].matchAll(/<key>([^<]+)<\/key>/g)].map((hit) => hit[1]);
}

export function readProjectFile(): string {
  return Deno.readTextFileSync(`${repoRoot}/ios/OneBoxM.xcodeproj/project.pbxproj`);
}

export function readExportOptions(path: string): string {
  return Deno.readTextFileSync(`${repoRoot}/${path}`);
}
