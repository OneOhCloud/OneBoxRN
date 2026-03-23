#!/usr/bin/env node
// sync-version-android.js — Sync version from app.json to android/app/build.gradle
//
// Usage: node scripts/sync-version-android.js

'use strict';

const fs = require('fs');

const app = JSON.parse(fs.readFileSync('app.json', 'utf8'));
const ver = app.expo.version;
const code = app.expo.android.versionCode;

const gradlePath = 'android/app/build.gradle';

if (!fs.existsSync(gradlePath)) {
  console.error(`Error: ${gradlePath} not found`);
  process.exit(1);
}

let txt = fs.readFileSync(gradlePath, 'utf8');
txt = txt.replace(/versionCode\s+\d+/, `versionCode ${code}`);
txt = txt.replace(/versionName\s+"[^"]*"/, `versionName "${ver}"`);
fs.writeFileSync(gradlePath, txt);

console.log(`  versionCode=${code}, versionName=${ver}`);
