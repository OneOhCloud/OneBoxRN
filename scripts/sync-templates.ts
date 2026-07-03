/// <reference types="node" />
/**
 * 构建期从 conf-template 仓库同步 sing-box 配置模板。
 *
 * 契约：
 *   - conf-template 是唯一来源。本脚本在构建/安装期拉取最新快照，以真正的
 *     TS 对象字面量形式写入 src/database/template/generated.ts。
 *   - 运行期模板加载器（src/database/config-template.ts 中的
 *     getDefaultConfigTemplate）在用户模板缓存为空时以该文件作为回落。
 *   - generated.ts 不入库（已 .gitignore）。每次全新 checkout 都会通过
 *     postinstall + Makefile 钩子重新运行本脚本。
 *
 * 为何在构建期（而非运行期）：
 *   - 永不更新的客户端也必须有一份合理的回落——它们拿到的就是安装包里
 *     烘焙的那份快照。
 *   - 能联网的客户端通过 src/database/config-template.ts 中的
 *     prefetchConfigTemplates() 获取更新的模板。构建期快照与实时拉取的内容
 *     共享同一来源，因此结构永不分叉——只有新鲜度不同。
 *
 * 版本解析与运行期共用——本脚本和 config-template.ts 中的运行期 URL 解析器
 * 都调用 src/utils/sing-box-template-path.ts 的 resolveVersionPath，因此快照
 * 与实时拉取总是就使用哪个 conf/<version>/zh-cn/ 目录达成一致。
 *
 * 分支：
 *   - 默认 stable。设置 CONF_TEMPLATE_BRANCH=beta|dev 切换非稳定通道。
 *
 * 离线回落：
 *   - 若拉取失败但上次运行已生成 generated.ts，则保留它并以警告退出 0。
 *     全新 checkout 且无网络时脚本快速失败——没有 generated.ts 应用无法打包。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { parse as parseJsonc, type ParseError } from 'jsonc-parser';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { parseSingBoxVersion, resolveVersionPath, type SingBoxVersion } from '../src/utils/sing-box-template-path.ts';

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

const REPO = 'OneOhCloud/conf-template';
const BRANCH = process.env.CONF_TEMPLATE_BRANCH ?? 'stable';

/**
 * OneBoxRN 只发布 TUN 模式。需与 src/definition.ts 中的 ConfigType 保持同步。
 */
const MODE_TO_FILE: Record<string, string> = {
    'tun-rules': 'tun-rules.jsonc',
    'tun-global': 'tun-global.jsonc',
};

/** 生成的 TS 常量的标识符（名字里不允许出现连字符）。 */
const IDENT_FOR: Record<string, string> = {
    'tun-rules': 'TUN_RULES_TEMPLATE',
    'tun-global': 'TUN_GLOBAL_TEMPLATE',
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, '../src/database/template/generated.ts');
const HELPER_MAKEFILE = resolve(
    __dirname,
    '../src/modules/expo-onebox/helper/Makefile',
);

// ---------------------------------------------------------------------------
// 版本发现 —— 从 helper Makefile 读取 SING_BOX_TAG，它是 gomobile 烘焙进
// Libbox 的唯一构建期来源。运行期 ExpoOneBox.getLibBoxVersion() 上报同一个值，
// 因此这里烘焙的快照永远不会与安装后的二进制最终返回的值发生漂移。
// ---------------------------------------------------------------------------

type BuildSingBoxVersion = SingBoxVersion & {
    /** 原始 tag，如 v1.13.8。 */
    tag: string;
    /** 去掉前导 v 的裸版本，如 1.13.8。 */
    bare: string;
};

function readSingBoxVersion(): BuildSingBoxVersion {
    const text = readFileSync(HELPER_MAKEFILE, 'utf-8');
    // 典型行：SING_BOX_TAG = "v1.13.8"（空白数量不限）。
    const match = text.match(/^\s*SING_BOX_TAG\s*=\s*"?(v?[\d.]+)"?\s*$/m);
    if (!match) {
        throw new Error(
            `could not find SING_BOX_TAG in ${HELPER_MAKEFILE} — ` +
            `refusing to guess the version at build time`,
        );
    }
    const tag = match[1].startsWith('v') ? match[1] : `v${match[1]}`;
    const bare = tag.replace(/^v/, '');
    const parsed = parseSingBoxVersion(bare);
    return { tag, bare, ...parsed };
}

// ---------------------------------------------------------------------------
// 拉取辅助
// ---------------------------------------------------------------------------

async function fetchText(url: string, label: string): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);
    try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
            throw new Error(`${label}: HTTP ${res.status} ${res.statusText}`);
        }
        return await res.text();
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * 尽力拉取目标分支上最新的 commit SHA。失败不致命——仍会写 generated.ts，
 * 只是元数据块里 SHA 记为 "unknown"。仅用于可追溯。
 */
async function fetchLatestSha(): Promise<string> {
    try {
        const res = await fetch(
            `https://api.github.com/repos/${REPO}/branches/${BRANCH}`,
            { headers: { 'User-Agent': 'oneboxrn-sync-templates' } },
        );
        if (!res.ok) return 'unknown';
        const json = (await res.json()) as { commit?: { sha?: string } };
        return json?.commit?.sha ?? 'unknown';
    } catch {
        return 'unknown';
    }
}

// ---------------------------------------------------------------------------
// 输出 —— 把解析后的模板写成真正的 TS 对象字面量，而非嵌在 TS 里的 JSON 字符串。
// 好处是生成文件会被 tsc 当作正常 TypeScript 解析：语法错误立即中断构建，
// 运行期消费方也能直接 import 这些对象，省去一次 JSON.parse。
// ---------------------------------------------------------------------------

type FetchedMode = { mode: string; parsed: unknown };

function emitGeneratedFile(
    version: BuildSingBoxVersion,
    versionPath: string,
    commitSha: string,
    fetched: FetchedMode[],
): string {
    const constants = fetched
        .map((r) => {
            const body = JSON.stringify(r.parsed, null, 4);
            return `export const ${IDENT_FOR[r.mode]} = ${body} as const;`;
        })
        .join('\n\n');

    const mapEntries = fetched
        .map((r) => `    '${r.mode}': ${IDENT_FOR[r.mode]},`)
        .join('\n');

    return `// AUTO-GENERATED by scripts/sync-templates.ts — do not commit, do not edit.
// Regenerate: npm run sync-templates
//
// Source:  https://github.com/${REPO}/tree/${BRANCH}/conf/${versionPath}/zh-cn
// Branch:  ${BRANCH}
// Commit:  ${commitSha}
// Built:   ${new Date().toISOString()}
// sing-box: ${version.tag} (from modules/expo-onebox/helper/Makefile:SING_BOX_TAG)

import type { ConfigType } from '@/definition';

${constants}

/**
 * Built-in template fallbacks, baked at build time from a snapshot of the
 * conf-template repo. Values are real JS objects — the runtime consumer
 * (\`getDefaultConfigTemplate\` in \`src/database/config-template.ts\`) stringifies
 * them when seeding the cache, so the store sees the same JSON-string
 * form every other read path does.
 *
 * Clients that can reach the network pick up fresher templates via
 * \`prefetchConfigTemplates()\`, so this snapshot is the floor, not the
 * ceiling — its age matches the app binary's ship date.
 */
export const BUILT_IN_TEMPLATE_OBJECTS: Record<ConfigType, unknown> = {
${mapEntries}
};
`;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    const version = readSingBoxVersion();
    const versionPath = resolveVersionPath(version);
    const modes = Object.keys(MODE_TO_FILE);

    console.log(
        `[sync-templates] ${version.tag} → conf/${versionPath}/zh-cn/  (branch: ${BRANCH})`,
    );

    let commitSha: string;
    let fetched: FetchedMode[];
    try {
        const results = await Promise.all([
            fetchLatestSha(),
            ...modes.map(async (mode): Promise<FetchedMode> => {
                const file = MODE_TO_FILE[mode];
                const url = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/conf/${versionPath}/zh-cn/${file}`;
                const text = await fetchText(url, file);
                const errors: ParseError[] = [];
                const parsed = parseJsonc(text, errors, { allowTrailingComma: true });
                if (errors.length > 0) {
                    throw new Error(
                        `${file}: jsonc parse errors\n` +
                        errors.map((e) => `  ${e.error} @offset ${e.offset}`).join('\n'),
                    );
                }
                if (!parsed || typeof parsed !== 'object') {
                    throw new Error(`${file}: did not parse as object`);
                }
                console.log(`[sync-templates]   ↓ ${file}`);
                return { mode, parsed };
            }),
        ]);
        commitSha = results[0] as string;
        fetched = results.slice(1) as FetchedMode[];
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        // 离线回落：保留上次运行遗留的 generated.ts。
        if (existsSync(OUTPUT_PATH)) {
            console.warn(
                `[sync-templates] fetch failed (${msg}); keeping existing snapshot at ${OUTPUT_PATH}`,
            );
            return;
        }
        throw e;
    }

    const content = emitGeneratedFile(version, versionPath, commitSha, fetched);
    mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
    writeFileSync(OUTPUT_PATH, content, 'utf-8');

    console.log(`[sync-templates] wrote ${OUTPUT_PATH}`);
    console.log(
        `[sync-templates] done (commit: ${commitSha === 'unknown' ? 'unknown' : commitSha.slice(0, 8)})`,
    );
}

main().catch((e) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[sync-templates] failed: ${msg}`);
    process.exit(1);
});
