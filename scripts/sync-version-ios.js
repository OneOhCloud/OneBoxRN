#!/usr/bin/env node
// sync-version-ios.js — Sync version from app.json to iOS Info.plist
//
// Usage: node scripts/sync-version-ios.js <APP_NAME>

'use strict';

const fs = require('fs');
const path = require('path');

const appName = process.argv[2];

if (!appName) {
  console.error('Usage: sync-version-ios.js <APP_NAME>');
  process.exit(1);
}

const app = JSON.parse(fs.readFileSync('app.json', 'utf8'));
const ver = app.expo.version;
const build = app.expo.ios.buildNumber;

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
