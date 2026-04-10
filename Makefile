# ============================================================
# OneBoxM — Local Build Makefile
# 依赖：将 .env.example 复制为 .env 并填写真实值
# ============================================================

-include .env
export

# ── 常量 ────────────────────────────────────────────────────
APP_NAME         := OneBoxM
TARGET_DIR       := target

# Android
ANDROID_DIR      := android
ANDROID_OUT_AAB  := $(ANDROID_DIR)/app/build/outputs/bundle/release/app-release.aab
ANDROID_OUT_APK  := $(ANDROID_DIR)/app/build/outputs/apk/release/app-release.apk

# iOS
IOS_WORKSPACE    := ios/$(APP_NAME).xcworkspace
IOS_SCHEME       := $(APP_NAME)
IOS_DERIVED_DATA := $(TARGET_DIR)/DerivedData
EXPORT_PLIST     := scripts/ios-export-options.plist
XCODE_ARCHIVES   := $(HOME)/Library/Developer/Xcode/Archives

# tun.db 自动更新
TUN_DB           := assets/data/tun.db
TUN_DB_URL       := https://github.com/OneOhCloud/conf-template/raw/refs/heads/database/database/stable/1.13/zh-cn/tun-cache-rule-v1.db
TUN_DB_MAX_AGE   := 86400

# Gradle 签名参数
GRADLE_SIGN_ARGS := \
	-PANDROID_KEYSTORE_PATH=$(ANDROID_KEYSTORE_PATH) \
	-PANDROID_STORE_PASSWORD=$(ANDROID_STORE_PASSWORD) \
	-PANDROID_KEY_ALIAS=$(ANDROID_KEY_ALIAS) \
	-PANDROID_KEY_PASSWORD=$(ANDROID_KEY_PASSWORD)

# ── 元信息 ──────────────────────────────────────────────────
.DEFAULT_GOAL := help

.PHONY: help \
        prebuild prebuild-android prebuild-ios \
        run-android run-ios \
        android android-aab android-apk \
        ios ios-archive \
        open-android open-ios \
        clean clean-android clean-ios \
        wipe-android-emulator \
        update-tun-db \
        _check-android-env _check-ios-env \
        _sync-version-android _sync-version-ios _update-tun-db \
	_ensure-pods _ensure-android-codegen _inject-ios-team \
	_verify-android-version

# ── 帮助 ────────────────────────────────────────────────────
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
	@echo ""
	@echo "  android             构建 Release AAB（= android-aab）"
	@echo "  android-aab         构建 Release AAB"
	@echo "  android-apk         构建 Release APK"
	@echo ""
	@echo "  ios                 创建 Archive（= ios-archive）"
	@echo "  ios-archive         创建 Archive，手动上传 App Store Connect"
	@echo ""
	@echo "  update-tun-db       强制更新 tun.db（构建时自动检查）"
	@echo ""
	@echo "  open-android        用 Android Studio 打开项目"
	@echo "  open-ios            用 Xcode 打开 Workspace"
	@echo ""
	@echo "  clean               清理全部构建产物"
	@echo "  clean-android       清理 Android（.cxx / build / gradle clean）"
	@echo "  clean-ios           清理 iOS（Pods / build / DerivedData / Archive）"
	@echo ""
	@echo "  wipe-android-emulator  清除 Android 模拟器数据（图标缓存等）"
	@echo ""

# ════════════════════════════════════════════════════════════
#  Prebuild
# ════════════════════════════════════════════════════════════

prebuild:
	npx expo prebuild --clean

prebuild-android:
	npx expo prebuild --platform android --clean

prebuild-ios:
	npx expo prebuild --platform ios --clean

# ════════════════════════════════════════════════════════════
#  开发调试
# ════════════════════════════════════════════════════════════

run-android: _update-tun-db _ensure-android-codegen
	npx expo run:android

run-ios: _check-ios-env _update-tun-db _ensure-pods _inject-ios-team
	npx expo run:ios --device

# ════════════════════════════════════════════════════════════
#  Android 构建
# ════════════════════════════════════════════════════════════

android: android-aab

android-aab: _check-android-env _update-tun-db _ensure-android-codegen _sync-version-android
	@echo "▶ 构建 Android AAB (release)..."
	cd $(ANDROID_DIR) && ./gradlew bundleRelease $(GRADLE_SIGN_ARGS)
	@$(MAKE) _verify-android-version
	@mkdir -p $(TARGET_DIR)
	@cp $(ANDROID_OUT_AAB) $(TARGET_DIR)/$(APP_NAME).aab
	@echo "✅ AAB → $(TARGET_DIR)/$(APP_NAME).aab"

android-apk: _check-android-env _update-tun-db _ensure-android-codegen _sync-version-android
	@echo "▶ 构建 Android APK (release)..."
	cd $(ANDROID_DIR) && ./gradlew assembleRelease $(GRADLE_SIGN_ARGS)
	@$(MAKE) _verify-android-version
	@mkdir -p $(TARGET_DIR)
	@cp $(ANDROID_OUT_APK) $(TARGET_DIR)/$(APP_NAME).apk
	@echo "✅ APK → $(TARGET_DIR)/$(APP_NAME).apk"

# ════════════════════════════════════════════════════════════
#  iOS 构建
# ════════════════════════════════════════════════════════════

ios: ios-archive

ios-archive: _check-ios-env _update-tun-db _sync-version-ios _ensure-pods _inject-ios-team
	@echo "▶ 创建 iOS Archive..."
	@mkdir -p $(TARGET_DIR)
	set -o pipefail && xcodebuild archive \
		-workspace $(IOS_WORKSPACE) \
		-scheme $(IOS_SCHEME) \
		-configuration Release \
		-archivePath $(TARGET_DIR)/$(APP_NAME).xcarchive \
		-derivedDataPath $(IOS_DERIVED_DATA) \
		-destination "generic/platform=iOS" \
		DEVELOPMENT_TEAM=$(IOS_TEAM_ID) \
		CODE_SIGN_STYLE=Automatic \
		| xcpretty
	@# 同步到 Xcode Organizer（按日期归档）
	$(eval ARCHIVE_DATE := $(shell date +%Y-%m-%d))
	$(eval ARCHIVE_NAME := $(APP_NAME) $(shell date +"%Y-%m-%d %H.%M.%S"))
	@mkdir -p "$(XCODE_ARCHIVES)/$(ARCHIVE_DATE)"
	@cp -R "$(TARGET_DIR)/$(APP_NAME).xcarchive" \
		"$(XCODE_ARCHIVES)/$(ARCHIVE_DATE)/$(ARCHIVE_NAME).xcarchive"
	@echo "✅ Archive → $(TARGET_DIR)/$(APP_NAME).xcarchive"
	@echo "✅ 已同步 → $(XCODE_ARCHIVES)/$(ARCHIVE_DATE)/"

# ════════════════════════════════════════════════════════════
#  IDE
# ════════════════════════════════════════════════════════════

open-android:
	open -a "Android Studio" $(ANDROID_DIR)

open-ios:
	open $(IOS_WORKSPACE)

# ════════════════════════════════════════════════════════════
#  清理
# ════════════════════════════════════════════════════════════

clean: clean-android clean-ios
	@echo "✅ 清理完成"

clean-android:
	rm -rf $(ANDROID_DIR)/app/.cxx
	rm -rf $(ANDROID_DIR)/app/build
	-cd $(ANDROID_DIR) && ./gradlew clean

clean-ios:
	rm -rf $(TARGET_DIR)/$(APP_NAME).xcarchive
	rm -rf ios/Pods
	rm -rf ios/build
	rm -rf $(IOS_DERIVED_DATA)

# ════════════════════════════════════════════════════════════
#  Android 模拟器
# ════════════════════════════════════════════════════════════

# 恢复出厂设置并冷启动 Android 模拟器，彻底清除所有缓存
wipe-android-emulator:
	@AVD=$$(emulator -list-avds | head -n 1); \
	if [ -z "$$AVD" ]; then \
		echo "❌ 未找到 AVD，请先在 Android Studio 中创建模拟器"; \
		exit 1; \
	fi; \
	echo "▶ 关闭模拟器..."; \
	adb emu kill 2>/dev/null || true; \
	sleep 2; \
	echo "▶ Wipe Data + Cold Boot: $$AVD"; \
	emulator -avd "$$AVD" -wipe-data -no-snapshot-load &\
	echo "✅ 模拟器已重置，等待启动后执行: make run-android"

# ════════════════════════════════════════════════════════════
#  内部目标（Internal Targets）
# ════════════════════════════════════════════════════════════

# ── 环境检查 ────────────────────────────────────────────────
_check-android-env:
	@test -n "$(ANDROID_KEYSTORE_PATH)"  || { echo "❌ ANDROID_KEYSTORE_PATH 未设置"; exit 1; }
	@test -n "$(ANDROID_KEY_ALIAS)"      || { echo "❌ ANDROID_KEY_ALIAS 未设置"; exit 1; }
	@test -n "$(ANDROID_STORE_PASSWORD)" || { echo "❌ ANDROID_STORE_PASSWORD 未设置"; exit 1; }
	@test -n "$(ANDROID_KEY_PASSWORD)"   || { echo "❌ ANDROID_KEY_PASSWORD 未设置"; exit 1; }
	@test -f "$(ANDROID_KEYSTORE_PATH)"  || { echo "❌ 密钥文件不存在: $(ANDROID_KEYSTORE_PATH)"; exit 1; }

_check-ios-env:
	@test -n "$(IOS_TEAM_ID)"  || { echo "❌ IOS_TEAM_ID 未设置"; exit 1; }
	@test -f "$(EXPORT_PLIST)" || { echo "❌ 找不到 $(EXPORT_PLIST)"; exit 1; }

# ── 签名注入 ────────────────────────────────────────────────
_inject-ios-team:
	@echo "▶ 确保 Xcode 项目包含 DEVELOPMENT_TEAM..."
	@node scripts/inject-ios-team.js "$(IOS_TEAM_ID)" "$(APP_NAME)"

# ── 依赖同步 ────────────────────────────────────────────────
_ensure-pods:
	@if [ ! -d "ios/Pods" ] || [ "ios/Podfile.lock" -ot "package.json" ]; then \
		echo "▶ Pods 缺失或可能过期，执行 pod install..."; \
		cd ios && pod install --repo-update; \
	else \
		echo "✔ Pods 已就绪"; \
	fi

_ensure-android-codegen:
	@if [ ! -d "$(ANDROID_DIR)/app/build/generated/autolinking" ]; then \
		echo "▶ Android codegen 缺失，执行 prebuild..."; \
		npx expo prebuild --platform android; \
	else \
		echo "✔ Android codegen 已就绪"; \
	fi

_verify-android-version:
	@echo "▶ 校验 Android 版本号..."
	@expected_code=$$(node -p "require('./version.json').androidVersionCode"); \
	expected_name=$$(node -p "require('./version.json').version"); \
	manifest=$$(find "$(ANDROID_DIR)/app/build/intermediates/merged_manifests/release" -name AndroidManifest.xml | head -n 1); \
	if [ -z "$$manifest" ]; then \
		echo "❌ 找不到 release merged manifest，无法校验版本号"; \
		exit 1; \
	fi; \
	actual_code=$$(grep -o 'android:versionCode="[0-9][0-9]*"' "$$manifest" | head -n 1 | sed 's/.*="//; s/"$$//'); \
	actual_name=$$(grep -o 'android:versionName="[^"]*"' "$$manifest" | head -n 1 | sed 's/.*="//; s/"$$//'); \
	if [ "$$actual_code" != "$$expected_code" ] || [ "$$actual_name" != "$$expected_name" ]; then \
		echo "❌ Android 版本校验失败: expected code=$$expected_code name=$$expected_name, actual code=$$actual_code name=$$actual_name"; \
		echo "   manifest=$$manifest"; \
		exit 1; \
	fi; \
	echo "✅ Android 版本校验通过: code=$$actual_code, name=$$actual_name"

# ── tun.db 更新（超过 24h 自动下载） ────────────────────────
update-tun-db:
	@echo "▶ 强制下载 tun.db..."
	@mkdir -p $$(dirname "$(TUN_DB)")
	@curl -fSL -o "$(TUN_DB)" "$(TUN_DB_URL)"
	@echo "✅ tun.db 已更新"

_update-tun-db:
	@if [ ! -f "$(TUN_DB)" ] || [ $$(($$(date +%s) - $$(stat -f %m "$(TUN_DB)"))) -gt $(TUN_DB_MAX_AGE) ]; then \
		echo "▶ tun.db 不存在或已超过 24 小时，正在下载..."; \
		mkdir -p $$(dirname "$(TUN_DB)"); \
		curl -fSL -o "$(TUN_DB)" "$(TUN_DB_URL)"; \
		echo "✅ tun.db 已更新"; \
	else \
		echo "✔ tun.db 有效期内，跳过下载"; \
	fi

# ── 版本号同步（app.json → native） ─────────────────────────
_sync-version-android:
	@echo "▶ 同步版本号到 Android..."
	@node scripts/sync-version-android.js

_sync-version-ios:
	@echo "▶ 同步版本号到 iOS..."
	@node scripts/sync-version-ios.js "$(APP_NAME)"
