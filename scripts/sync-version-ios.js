#!/usr/bin/env node
// sync-version-ios.js — 将 version.json 的版本号同步到 iOS Info.plist
//
// 用法：node scripts/sync-version-ios.js <APP_NAME>

'use strict';

const fs = require('fs');
const path = require('path');

const appName = process.argv[2];

if (!appName) {
  console.error('Usage: sync-version-ios.js <APP_NAME>');
  process.exit(1);
}

const versionConfig = JSON.parse(fs.readFileSync('version.json', 'utf8'));
const ver = versionConfig.version;
const build = String(versionConfig.iosBuildNumber);

const plistPath = path.join('ios', appName, 'Info.plist');

if (!fs.existsSync(plistPath)) {
  console.error(`Error: ${plistPath} not found`);
  process.exit(1);
}

let txt = fs.readFileSync(plistPath, 'utf8');

txt = txt.replace(
  /(<key>CFBundleShortVersionString<\/key>\s*<string>)[^<]*(<\/string>)/,
  `$1${ver}$2`
);

txt = txt.replace(
  /(<key>CFBundleVersion<\/key>\s*<string>)[^<]*(<\/string>)/,
  `$1${build}$2`
);

fs.writeFileSync(plistPath, txt);
console.log(`  CFBundleShortVersionString=${ver}, CFBundleVersion=${build}`);
