/// <reference types="node" />
/**
 * Build-time sync of sing-box config templates from the conf-template repo.
 *
 * Contract:
 *   - `conf-template` is the single source of truth. This script pulls the
 *     latest snapshot at build/install time and bakes it into
 *     `src/database/template/generated.ts` as real TS object literals.
 *   - The runtime template loader (`getDefaultConfigTemplate` in
 *     `src/database/config-template.ts`) reads from that file as its
 *     fallback when the user's template cache is empty.
 *   - The generated file is NOT committed (`.gitignore`d). Every fresh
 *     checkout re-runs this script via `postinstall` + Makefile hooks.
 *
 * Why build-time (not runtime):
 *   - Clients that never update must still have a sane fallback — they get
 *     whatever snapshot was baked into the binary they installed.
 *   - Clients that can reach the network pick up fresher templates via
 *     `prefetchConfigTemplates()` in `src/database/config-template.ts`. Build-time
 *     snapshot and live-fetched content share the same source of truth,
 *     so they never diverge in shape — only in freshness.
 *
 * Version resolution is shared with the runtime — both this script and the
 * runtime URL resolver in `config-template.ts` call `resolveVersionPath` from
 * `src/utils/sing-box-template-path.ts`, so snapshot and live fetch always
 * agree on which `conf/<version>/zh-cn/` directory to use.
 *
 * Branch:
 *   - Defaults to `stable`. Override with `CONF_TEMPLATE_BRANCH=beta|dev`
 *     for non-stable channels.
 *
 * Offline fallback:
 *   - If fetch fails but `generated.ts` already exists from a previous run,
 *     we keep it and exit 0 with a warning. On fresh checkouts with no
 *     network, the script fails fast — without `generated.ts` the app
 *     cannot bundle.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { parse as parseJsonc, type ParseError } from 'jsonc-parser';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { parseSingBoxVersion, resolveVersionPath, type SingBoxVersion } from '../src/utils/sing-box-template-path.ts';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const REPO = 'OneOhCloud/conf-template';
const BRANCH = process.env.CONF_TEMPLATE_BRANCH ?? 'stable';

/**
 * OneBoxRN only ships TUN modes. Keep in sync with `ConfigType` in
 * `src/definition.ts`.
 */
const MODE_TO_FILE: Record<string, string> = {
    'tun-rules': 'tun-rules.jsonc',
    'tun-global': 'tun-global.jsonc',
};

/** Identifiers for the emitted TS constants (dashes not allowed in names). */
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
// Version discovery — read SING_BOX_TAG from the helper Makefile, which is
// the single build-time source that gomobile bakes into Libbox. Runtime
// `ExpoOneBox.getLibBoxVersion()` reports this same value, so the
// snapshot baked here can never drift from what the installed binary
// eventually returns.
// ---------------------------------------------------------------------------

type BuildSingBoxVersion = SingBoxVersion & {
    /** Raw tag, e.g. `v1.13.8`. */
    tag: string;
    /** Bare form without leading `v`, e.g. `1.13.8`. */
    bare: string;
};

function readSingBoxVersion(): BuildSingBoxVersion {
    const text = readFileSync(HELPER_MAKEFILE, 'utf-8');
    // Typical line: `SING_BOX_TAG = "v1.13.8"` (any amount of whitespace).
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
// Fetch helpers
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
 * Best-effort fetch of the latest commit SHA on the target branch. Failure
 * is non-fatal — we still write `generated.ts`, just with an "unknown" SHA
 * in the metadata block. Used purely for traceability.
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
// Emit — write parsed templates as real TS object literals, not as
// JSON-strings-inside-TS. The advantage is that the generated file is
// parsed by `tsc` as normal TypeScript code: syntax errors trip the build
// immediately, and the runtime consumer can import the objects directly
// without a JSON.parse round-trip.
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
// Main
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
        // Offline fallback: keep any existing generated.ts from a prior run.
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
