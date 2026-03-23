#!/usr/bin/env node
// inject-ios-team.js — Ensure Xcode project contains DEVELOPMENT_TEAM
//
// Usage: node scripts/inject-ios-team.js <TEAM_ID> <APP_NAME>

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

// Replace existing DEVELOPMENT_TEAM entries
txt = txt.replace(/DEVELOPMENT_TEAM = [^;]*;/g, `DEVELOPMENT_TEAM = ${teamId};`);

// If a buildSettings block lacks DEVELOPMENT_TEAM, inject after CURRENT_PROJECT_VERSION
txt = txt.replace(
  /(buildSettings\s*=\s*\{[^}]*?CURRENT_PROJECT_VERSION\s*=\s*[^;]*;)\n((?!\s*DEVELOPMENT_TEAM))/g,
  `$1\n\t\t\t\tDEVELOPMENT_TEAM = ${teamId};\n$2`
);

fs.writeFileSync(pbxprojPath, txt);
console.log(`  DEVELOPMENT_TEAM = ${teamId}`);
