#!/usr/bin/env node
// inject-ios-team.js — 确保 Xcode 工程包含 DEVELOPMENT_TEAM
//
// 用法：node scripts/inject-ios-team.js <TEAM_ID> <APP_NAME>

'use strict';

const fs = require('fs');
const path = require('path');

const teamId = process.argv[2];
const appName = process.argv[3];

if (!teamId || !appName) {
  console.error('Usage: inject-ios-team.js <TEAM_ID> <APP_NAME>');
  process.exit(1);
}

const pbxprojPath = path.join('ios', `${appName}.xcodeproj`, 'project.pbxproj');

if (!fs.existsSync(pbxprojPath)) {
  console.error(`Error: ${pbxprojPath} not found`);
  process.exit(1);
}

let txt = fs.readFileSync(pbxprojPath, 'utf8');

// 替换已有的 DEVELOPMENT_TEAM 条目
txt = txt.replace(/DEVELOPMENT_TEAM = [^;]*;/g, `DEVELOPMENT_TEAM = ${teamId};`);

// 若某个 buildSettings 块缺少 DEVELOPMENT_TEAM，在 CURRENT_PROJECT_VERSION 之后注入
txt = txt.replace(
  /(buildSettings\s*=\s*\{[^}]*?CURRENT_PROJECT_VERSION\s*=\s*[^;]*;)\n((?!\s*DEVELOPMENT_TEAM))/g,
  `$1\n\t\t\t\tDEVELOPMENT_TEAM = ${teamId};\n$2`
);

fs.writeFileSync(pbxprojPath, txt);
console.log(`  DEVELOPMENT_TEAM = ${teamId}`);
