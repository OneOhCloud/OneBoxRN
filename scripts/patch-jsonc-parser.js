#!/usr/bin/env node
/**
 * Makes jsonc-parser's UMD files compatible with Metro bundler.
 *
 * Two problems exist in the UMD wrapper:
 *
 * 1. AMD branch — Metro's static analyzer registers every string in
 *    define([...]) as a module dependency, causing "Requiring unknown module"
 *    at build time.
 *
 * 2. require/exports parameter shadowing — the UMD wrapper calls:
 *      factory(require, exports)
 *    with factory declared as:
 *      function (require, exports) { ... }
 *    Metro's Babel transform detects the shadow and does NOT replace
 *    require("./impl/format") with the dep-ID form. At runtime Metro's
 *    require only accepts dep IDs, not string paths → "Requiring unknown module".
 *
 * Fix: (a) remove the AMD branch, (b) drop the (require, exports) parameters
 * from the factory so Metro's Babel transform can replace require() calls with
 * dep IDs as expected.
 *
 * Run automatically via `postinstall` in package.json.
 */

'use strict';
const fs = require('fs');
const path = require('path');

const umdDir = path.resolve(__dirname, '../node_modules/jsonc-parser/lib/umd');
const implDir = path.join(umdDir, 'impl');

let implFiles;
try {
    implFiles = fs.readdirSync(implDir).filter(f => f.endsWith('.js'));
} catch {
    console.log('[patch-jsonc-parser] jsonc-parser not installed, skipping.');
    process.exit(0);
}

const targets = [
    path.join(umdDir, 'main.js'),
    ...implFiles.map(f => path.join(implDir, f)),
];

// Remove AMD else-if branch.
const AMD_BRANCH_RE =
    /\s*else if\s*\(typeof define\s*===\s*["']function["']\s*&&\s*define\.amd\s*\)\s*\{[\s\S]*?\}/g;

// Strip (require, exports) parameters from the factory so Metro's Babel
// transform can rewrite require() calls to dep-ID form.
const FACTORY_PARAMS_RE = /\}\)\s*\(function\s*\(require,\s*exports\)/g;

let patched = 0;
for (const file of targets) {
    let src = fs.readFileSync(file, 'utf-8');
    const original = src;
    src = src.replace(AMD_BRANCH_RE, '').replace(FACTORY_PARAMS_RE, '})(function ()');
    if (src !== original) {
        fs.writeFileSync(file, src, 'utf-8');
        patched++;
        console.log(`[patch-jsonc-parser] patched ${path.relative(process.cwd(), file)}`);
    }
}

console.log(`[patch-jsonc-parser] done — ${patched} file(s) patched.`);
