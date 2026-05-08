# ============================================================
# OneBoxM — Local Build Makefile
# 依赖：将 .env.example 复制为 .env 并填写真实值
# ============================================================

-include .env
export

# ── 常量 ────────────────────────────────────────────────────
APP_NAME         := OneBoxM
TARGET_DIR       := target
PKG              := cloud.oneoh.networktools

# Android
ANDROID_DIR      := android
ANDROID_OUT_AAB  := $(ANDROID_DIR)/app/build/outputs/bundle/release/app-release.aab
ANDROID_OUT_APK  := $(ANDROID_DIR)/app/build/outputs/apk/release/app-release.apk

GRADLE_SIGN_ARGS := \
	-PANDROID_KEYSTORE_PATH=$(ANDROID_KEYSTORE_PATH) \
	-PANDROID_STORE_PASSWORD=$(ANDROID_STORE_PASSWORD) \
	-PANDROID_KEY_ALIAS=$(ANDROID_KEY_ALIAS) \
	-PANDROID_KEY_PASSWORD=$(ANDROID_KEY_PASSWORD)

# iOS
IOS_WORKSPACE    := ios/$(APP_NAME).xcworkspace
IOS_SCHEME       := $(APP_NAME)
IOS_DERIVED_DATA := $(TARGET_DIR)/DerivedData
IOS_SOURCEMAP    := $(TARGET_DIR)/ios/main.jsbundle.map
EXPORT_PLIST     := scripts/ios-export-options.plist
XCODE_ARCHIVES   := $(HOME)/Library/Developer/Xcode/Archives

# tun.db
TUN_DB           := assets/data/tun.db
TUN_DB_URL       := https://github.com/OneOhCloud/conf-template/raw/refs/heads/database/database/stable/1.13/zh-cn/tun-cache-rule-v1.db
TUN_DB_MAX_AGE   := 86400

# ── 子模块 ──────────────────────────────────────────────────
include make/common.mk
include make/android.mk
include make/ios.mk
include make/test.mk

# ── 帮助 ────────────────────────────────────────────────────
.DEFAULT_GOAL := help

.PHONY: help

help:
	@echo ""
	@echo "  OneBoxM 本地构建命令"
	@echo "  ─────────────────────────────────────────────"
	@echo ""
	@echo "  prebuild            expo prebuild（全平台）"
	@echo "  prebuild-android    仅 Android prebuild"
	@echo "  prebuild-ios        仅 iOS prebuild"
	@echo ""
	@echo "  run-android         开发调试 Android（真机/模拟器）"
	@echo "  run-ios             开发调试 iOS（真机/模拟器）"
	@echo "  crash-ios           解析 iOS 崩溃日志（需传 CRASH=/path/to/.crash 或 .xccrashpoint）"
	@echo ""
	@echo "  dev-smoke-android   触发 /dev-smoke 深链 —— 跑 import smoke"
	@echo "  dev-smoke-ios       （在 run-* 之后，Metro 'Bundled' 完成再点）"
	@echo ""
	@echo "  android             构建 Release AAB（= android-aab）"
	@echo "  android-aab         构建 Release AAB"
	@echo "  android-apk         构建 Release APK"
	@echo "  android-install     安装 target/OneBoxM.apk 到 Android 模拟器"
	@echo "  upload-bugsnag-android 上传 Android AAB symbols 和 RN sourcemap 到 Bugsnag"
	@echo ""
	@echo "  ios                 创建 Archive（= ios-archive）"
	@echo "  ios-archive         创建 Archive，手动上传 App Store Connect"
	@echo "  upload-bugsnag-ios 上传 iOS dSYM 和 RN sourcemap 到 Bugsnag"
	@echo ""
	@echo "  update-tun-db       强制更新 tun.db（构建时自动检查）"
	@echo ""
	@echo "  open-android        用 Android Studio 打开项目"
	@echo "  open-ios            用 Xcode 打开 Workspace"
	@echo ""
	@echo "  sync-s3             同步 target/s3/ 下的 APK 到 S3"
	@echo ""
	@echo "  clean               清理全部构建产物"
	@echo "  clean-android       清理 Android（.cxx / build / gradle clean）"
	@echo "  clean-ios           清理 iOS（Pods / build / DerivedData / Archive）"
	@echo ""
	@echo "  wipe-android-emulator  清除 Android 模拟器数据（图标缓存等）"
	@echo "  screenshot-android     adb 截图 Android 模拟器/真机 → target/screenshots/"
	@echo ""
	@echo "  test                运行本地单元测试（node:test 纯 TS）"
	@echo "  test-bg-worker      触发后台 Worker 并验证 doWork() 结果（需已导入 profile）"
	@echo "  test-bg-trigger     仅触发后台 Worker，不等待（快速调试）"
	@echo "  adb-logcat-bg       实时查看后台 Worker 日志"
	@echo ""
