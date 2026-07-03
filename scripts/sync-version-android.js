#!/usr/bin/env node
// sync-version-android.js — 将 version.json 的版本号同步到 android/app/build.gradle
//
// 用法：node scripts/sync-version-android.js

'use strict';

const fs = require('fs');
const { execSync } = require('child_process');

const versionConfig = JSON.parse(fs.readFileSync('version.json', 'utf8'));
const ver = versionConfig.version;
const code = versionConfig.androidVersionCode;

if (typeof code !== 'number' || !Number.isInteger(code) || code < 1) {
  console.error(`❌ androidVersionCode 必须是正整数，当前值: ${code}`);
  process.exit(1);
}

// 从 git 历史中读取上一次提交的 androidVersionCode，确保只增不减
try {
  const prevJson = execSync('git show HEAD:version.json', { encoding: 'utf8' });
  const prevConfig = JSON.parse(prevJson);
  const prevCode = prevConfig.androidVersionCode ?? prevConfig.buildNumber;
  if (typeof prevCode === 'number' && code <= prevCode) {
    console.error(`❌ androidVersionCode 不允许减小或不变！`);
    console.error(`   上一个提交: ${prevCode}，当前值: ${code}`);
    console.error(`   请将 androidVersionCode 改为大于 ${prevCode} 的整数`);
    process.exit(1);
  }
  console.log(`  androidVersionCode: ${prevCode} → ${code} ✓`);
} catch {
  // 新仓库或 version.json 首次提交，跳过检查
  console.log(`  androidVersionCode: ${code} (跳过历史校验)`);
}

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
