# ============================================================
# OneBoxM — Local Build Makefile
# 依赖：将 .env.example 复制为 .env 并填写真实值
# ============================================================

# 加载 .env（如果存在）
-include .env
export

# ── 项目常量 ────────────────────────────────────────────────
APP_NAME        := OneBoxM
IOS_WORKSPACE   := ios/$(APP_NAME).xcworkspace
IOS_SCHEME      := $(APP_NAME)
EXPORT_PLIST    := scripts/ios-export-options.plist
XCODE_ARCHIVES := $(HOME)/Library/Developer/Xcode/Archives

ANDROID_DIR     := android
ANDROID_OUT_AAB := $(ANDROID_DIR)/app/build/outputs/bundle/release/app-release.aab
ANDROID_OUT_APK := $(ANDROID_DIR)/app/build/outputs/apk/release/app-release.apk

TARGET_DIR      := target
IOS_DERIVED_DATA := $(TARGET_DIR)/DerivedData

# ── 默认目标 ────────────────────────────────────────────────
.DEFAULT_GOAL := help

.PHONY: help prebuild prebuild-android prebuild-ios \
        android android-aab android-apk \
        ios ios-archive \
        _sync-version-android _sync-version-ios \
        open-android open-ios \
        clean clean-android clean-ios clean-ios-cache

# ── 帮助 ────────────────────────────────────────────────────
help:
	@echo ""
	@echo "  OneBoxM 本地构建命令"
	@echo "  ─────────────────────────────────────────────"
	@echo "  prebuild          运行 expo prebuild（全平台）"
	@echo "  prebuild-android  仅 Android prebuild"
	@echo "  prebuild-ios      仅 iOS prebuild"
	@echo ""
	@echo "  android           构建 Android Release AAB（= android-aab）"
	@echo "  android-aab       构建 Android Release AAB"
	@echo "  android-apk       构建 Android Release APK"
	@echo ""
	@echo "  ios               创建 iOS Archive（= ios-archive）"
	@echo "  ios-archive       创建 iOS Archive (.xcarchive)，手动上传到 App Store Connect"
	@echo ""
	@echo "  open-android      用 Android Studio 打开项目"
	@echo "  open-ios          用 Xcode 打开 Workspace"
	@echo ""
	@echo "  clean             清理全部构建产物"
	@echo "  clean-android     清理 Android 构建产物"
	@echo "  clean-ios         清理 iOS Archive"
	@echo "  clean-ios-cache   清理 iOS DerivedData（遇到奇怪编译错误时使用）"
	@echo ""

# ── Expo Prebuild ────────────────────────────────────────────
prebuild:
	npx expo prebuild --clean

prebuild-android:
	npx expo prebuild --platform android --clean

prebuild-ios:
	npx expo prebuild --platform ios --clean

# ── Android ─────────────────────────────────────────────────
_check-android-env:
	@test -n "$(ANDROID_KEYSTORE_PATH)"  || (echo "❌ ANDROID_KEYSTORE_PATH 未设置，请检查 .env"; exit 1)
	@test -n "$(ANDROID_KEY_ALIAS)"      || (echo "❌ ANDROID_KEY_ALIAS 未设置，请检查 .env"; exit 1)
	@test -n "$(ANDROID_STORE_PASSWORD)" || (echo "❌ ANDROID_STORE_PASSWORD 未设置，请检查 .env"; exit 1)
	@test -n "$(ANDROID_KEY_PASSWORD)"   || (echo "❌ ANDROID_KEY_PASSWORD 未设置，请检查 .env"; exit 1)
	@test -f "$(ANDROID_KEYSTORE_PATH)"  || (echo "❌ 密钥文件不存在: $(ANDROID_KEYSTORE_PATH)"; exit 1)

android: android-aab

android-aab: _check-android-env _sync-version-android
	@echo "▶ 构建 Android AAB (release)..."
	cd $(ANDROID_DIR) && ./gradlew bundleRelease \
		-PANDROID_KEYSTORE_PATH=$(ANDROID_KEYSTORE_PATH) \
		-PANDROID_STORE_PASSWORD=$(ANDROID_STORE_PASSWORD) \
		-PANDROID_KEY_ALIAS=$(ANDROID_KEY_ALIAS) \
		-PANDROID_KEY_PASSWORD=$(ANDROID_KEY_PASSWORD)
	@mkdir -p $(TARGET_DIR)
	@cp $(ANDROID_OUT_AAB) $(TARGET_DIR)/$(APP_NAME).aab
	@echo "✅ AAB 输出: $(TARGET_DIR)/$(APP_NAME).aab"

android-apk: _check-android-env _sync-version-android
	@echo "▶ 构建 Android APK (release)..."
	cd $(ANDROID_DIR) && ./gradlew assembleRelease \
		-PANDROID_KEYSTORE_PATH=$(ANDROID_KEYSTORE_PATH) \
		-PANDROID_STORE_PASSWORD=$(ANDROID_STORE_PASSWORD) \
		-PANDROID_KEY_ALIAS=$(ANDROID_KEY_ALIAS) \
		-PANDROID_KEY_PASSWORD=$(ANDROID_KEY_PASSWORD)
	@mkdir -p $(TARGET_DIR)
	@cp $(ANDROID_OUT_APK) $(TARGET_DIR)/$(APP_NAME).apk
	@echo "✅ APK 输出: $(TARGET_DIR)/$(APP_NAME).apk"

# ── iOS ─────────────────────────────────────────────────────
_check-ios-env:
	@test -n "$(IOS_TEAM_ID)" || (echo "❌ IOS_TEAM_ID 未设置，请检查 .env"; exit 1)
	@test -f "$(EXPORT_PLIST)" || (echo "❌ 找不到 $(EXPORT_PLIST)"; exit 1)

ios: ios-archive

ios-archive: _check-ios-env _sync-version-ios
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
	@echo "✅ Archive 输出: $(TARGET_DIR)/$(APP_NAME).xcarchive"
	@echo "✅ 已同步到 Xcode Organizer: $(XCODE_ARCHIVES)/$(ARCHIVE_DATE)/"

# ── 版本号同步（从 app.json → native 项目文件） ──────────────
_sync-version-android:
	@echo "▶ 同步版本号到 Android..."
	@node -e " \
	  const fs = require('fs'); \
	  const app = JSON.parse(fs.readFileSync('app.json','utf8')); \
	  const ver = app.expo.version; \
	  const code = app.expo.android.versionCode; \
	  const f = 'android/app/build.gradle'; \
	  let txt = fs.readFileSync(f,'utf8'); \
	  txt = txt.replace(/versionCode\s+\d+/, 'versionCode ' + code); \
	  txt = txt.replace(/versionName\s+\"[^\"]*\"/, 'versionName \"' + ver + '\"'); \
	  fs.writeFileSync(f, txt); \
	  console.log('  versionCode=' + code + ', versionName=' + ver); \
	"

_sync-version-ios:
	@echo "▶ 同步版本号到 iOS..."
	@node -e " \
	  const fs = require('fs'); \
	  const app = JSON.parse(fs.readFileSync('app.json','utf8')); \
	  const ver = app.expo.version; \
	  const build = app.expo.ios.buildNumber; \
	  const f = 'ios/OneBoxM/Info.plist'; \
	  let txt = fs.readFileSync(f,'utf8'); \
	  txt = txt.replace( \
	    /(<key>CFBundleShortVersionString<\/key>\s*<string>)[^<]*(<\/string>)/, \
	    '\$$1' + ver + '\$$2'); \
	  txt = txt.replace( \
	    /(<key>CFBundleVersion<\/key>\s*<string>)[^<]*(<\/string>)/, \
	    '\$$1' + build + '\$$2'); \
	  fs.writeFileSync(f, txt); \
	  console.log('  CFBundleShortVersionString=' + ver + ', CFBundleVersion=' + build); \
	"

# ── 打开 IDE ─────────────────────────────────────────────────
open-android:
	open -a "Android Studio" $(ANDROID_DIR)

open-ios:
	open $(IOS_WORKSPACE)

# ── 清理 ─────────────────────────────────────────────────────
clean-android:
	cd $(ANDROID_DIR) && ./gradlew clean
	rm -rf $(ANDROID_DIR)/app/build

clean-ios:
	rm -rf $(TARGET_DIR)/$(APP_NAME).xcarchive

clean-ios-cache:
	@echo "▶ 清理 iOS DerivedData 缓存（下次构建将完整重编）..."
	rm -rf $(IOS_DERIVED_DATA)
	@echo "✅ DerivedData 已清理"

clean: clean-android clean-ios
	@echo "✅ 清理完成"
