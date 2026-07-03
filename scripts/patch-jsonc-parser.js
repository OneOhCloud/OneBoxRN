#!/usr/bin/env node
/**
 * 让 jsonc-parser 的 UMD 文件兼容 Metro 打包器。
 *
 * UMD wrapper 存在两个问题：
 *
 * 1. AMD 分支 —— Metro 的静态分析器会把 define([...]) 里的每个字符串都登记为
 *    模块依赖，导致构建期报 "Requiring unknown module"。
 *
 * 2. require/exports 形参遮蔽 —— UMD wrapper 这样调用：
 *      factory(require, exports)
 *    而 factory 声明为：
 *      function (require, exports) { ... }
 *    Metro 的 Babel transform 检测到遮蔽，就不会把 require("./impl/format")
 *    替换成 dep-ID 形式。运行期 Metro 的 require 只接受 dep ID 而非字符串路径
 *    → "Requiring unknown module"。
 *
 * 修复：(a) 移除 AMD 分支，(b) 从 factory 去掉 (require, exports) 形参，让 Metro
 * 的 Babel transform 能如常把 require() 调用替换为 dep ID。
 *
 * 通过 package.json 的 postinstall 自动运行。
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

// 移除 AMD 的 else-if 分支。
const AMD_BRANCH_RE =
    /\s*else if\s*\(typeof define\s*===\s*["']function["']\s*&&\s*define\.amd\s*\)\s*\{[\s\S]*?\}/g;

// 从 factory 去掉 (require, exports) 形参，让 Metro 的 Babel transform
// 能把 require() 调用改写成 dep-ID 形式。
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
