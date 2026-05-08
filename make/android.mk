.PHONY: android android-aab android-apk android-install upload-bugsnag-android \
        run-android dev-smoke-android \
        clean-android \
        wipe-android-emulator \
        screenshot-android \
        _check-android-env _ensure-android-codegen \
        _sync-version-android _verify-android-version

# ════════════════════════════════════════════════════════════
#  构建
# ════════════════════════════════════════════════════════════

android: android-aab

android-aab: _check-android-env _sync-templates _update-tun-db _ensure-android-codegen _sync-version-android
	@echo "▶ 构建 Android AAB (release)..."
	cd $(ANDROID_DIR) && ./gradlew bundleRelease $(GRADLE_SIGN_ARGS)
	@$(MAKE) _verify-android-version
	@mkdir -p $(TARGET_DIR)
	@cp $(ANDROID_OUT_AAB) $(TARGET_DIR)/$(APP_NAME).aab
	@echo "✅ AAB → $(TARGET_DIR)/$(APP_NAME).aab"
	@echo "ℹ️  上传 Google Play 前建议执行: make upload-bugsnag-android"

android-apk: _check-android-env _sync-templates _update-tun-db _ensure-android-codegen _sync-version-android
	@echo "▶ 构建 Android APK (release)..."
	cd $(ANDROID_DIR) && ./gradlew assembleRelease $(GRADLE_SIGN_ARGS)
	@$(MAKE) _verify-android-version
	@mkdir -p $(TARGET_DIR)
	@cp $(ANDROID_OUT_APK) $(TARGET_DIR)/$(APP_NAME).apk
	@echo "✅ APK → $(TARGET_DIR)/$(APP_NAME).apk"

android-install:
	@if ! command -v adb >/dev/null 2>&1; then \
		echo "❌ adb 不在 PATH，请先安装 Android Platform Tools"; \
		exit 1; \
	fi; \
	if [ ! -f "$(TARGET_DIR)/$(APP_NAME).apk" ]; then \
		echo "❌ 未找到 APK: $(TARGET_DIR)/$(APP_NAME).apk"; \
		echo "   请先运行: make android-apk"; \
		exit 1; \
	fi; \
	if [ -n "$(ADB_SERIAL)" ]; then \
		adb_args="-s $(ADB_SERIAL)"; \
		if ! adb devices | awk 'NR>1 && $$1=="$(ADB_SERIAL)" && $$2=="device" { found=1 } END { exit !found }'; then \
			echo "❌ ADB_SERIAL 不在线: $(ADB_SERIAL)"; \
			adb devices; \
			exit 1; \
		fi; \
		target="$(ADB_SERIAL)"; \
	else \
		emulators=$$(adb devices | awk 'NR>1 && $$1 ~ /^emulator-/ && $$2=="device" { print $$1 }'); \
		count=$$(printf "%s\n" "$$emulators" | sed '/^$$/d' | wc -l | tr -d ' '); \
		if [ "$$count" -eq 0 ]; then \
			echo "❌ 未检测到已启动的 Android 模拟器"; \
			echo "   请先启动 emulator，或使用 ADB_SERIAL=<serial> 指定设备"; \
			adb devices; \
			exit 1; \
		fi; \
		if [ "$$count" -gt 1 ]; then \
			echo "❌ 检测到多个 Android 模拟器，请指定 ADB_SERIAL:"; \
			printf "%s\n" "$$emulators"; \
			exit 1; \
		fi; \
		target="$$emulators"; \
		adb_args="-s $$target"; \
	fi; \
	echo "▶ 安装 APK 到 $$target..."; \
	adb $$adb_args install -r "$(TARGET_DIR)/$(APP_NAME).apk" || { \
		echo "⚠️  安装失败，可能是设备上已有不同签名版本: $(PKG)"; \
		printf "是否卸载现有应用并重试安装？这会清除该应用本地数据。[y/N] "; \
		read answer; \
		case "$$answer" in \
			y|Y|yes|YES|Yes) \
				echo "▶ 卸载 $(PKG)..."; \
				adb $$adb_args uninstall "$(PKG)" || { echo "❌ 卸载失败"; exit 1; }; \
				echo "▶ 重新安装 APK 到 $$target..."; \
				adb $$adb_args install -r "$(TARGET_DIR)/$(APP_NAME).apk" || { echo "❌ 重新安装失败"; exit 1; }; \
				;; \
			*) \
				echo "❌ 已取消卸载，安装未完成"; \
				exit 1; \
				;; \
		esac; \
	}; \
	echo "✅ 已安装到 $$target"

upload-bugsnag-android:
	@test -n "$(BUGSNAG_API_KEY)" || { echo "❌ BUGSNAG_API_KEY 未设置，请在 .env 中配置"; exit 1; }
	@if [ ! -f "$(TARGET_DIR)/$(APP_NAME).aab" ]; then \
		echo "❌ 未找到 AAB: $(TARGET_DIR)/$(APP_NAME).aab"; \
		echo "   请先运行: make android"; \
		exit 1; \
	fi
	@if [ ! -f "$(ANDROID_DIR)/app/build/generated/assets/react/release/index.android.bundle" ]; then \
		echo "❌ 未找到 Android JS bundle，请先运行: make android"; \
		exit 1; \
	fi
	@if [ ! -f "$(ANDROID_DIR)/app/build/generated/sourcemaps/react/release/index.android.bundle.map" ]; then \
		echo "❌ 未找到 Android JS source map，请先运行: make android"; \
		exit 1; \
	fi
	@echo "▶ 上传 Android AAB symbols/mappings 到 Bugsnag..."
	@npx bugsnag-cli upload android-aab "$(TARGET_DIR)/$(APP_NAME).aab" \
		--api-key "$(BUGSNAG_API_KEY)" \
		--exclude "**/libcrypto.so.sym" \
		|| echo "⚠️  Android AAB symbols/mappings 上传失败，继续上传 React Native source map"
	@echo "▶ 上传 React Native Android source map 到 Bugsnag..."
	npx bugsnag-cli upload react-native-sourcemaps \
		--api-key "$(BUGSNAG_API_KEY)" \
		--platform android \
		--bundle "$(ANDROID_DIR)/app/build/generated/assets/react/release/index.android.bundle" \
		--source-map "$(ANDROID_DIR)/app/build/generated/sourcemaps/react/release/index.android.bundle.map" \
		--version-name "$$(node -p "require('./version.json').version")" \
		--version-code "$$(node -p "require('./version.json').androidVersionCode")"
	@echo "✅ Bugsnag Android 上传完成"

# ════════════════════════════════════════════════════════════
#  开发调试
# ════════════════════════════════════════════════════════════

run-android: _sync-templates _update-tun-db _ensure-android-codegen
	@echo ""
	@echo "  ────────────────────────────────────────────────────────────"
	@echo "  Once you see 'Android Bundled …ms' in the Metro output below,"
	@echo "  run this in another terminal to trigger the import smoke check:"
	@echo ""
	@echo "      make dev-smoke-android"
	@echo "  ────────────────────────────────────────────────────────────"
	@echo ""
	npx expo run:android

# Fire the /dev-smoke deep link on whichever adb target is current.
# Safe to call manually any time the app is running — just navigates
# to the Import Smoke Check page.
dev-smoke-android:
	@URL="oneoh-networktools://dev-smoke"; \
	if command -v adb >/dev/null 2>&1; then \
		adb shell am start -W -a android.intent.action.VIEW -d "$$URL" >/dev/null 2>&1 \
			&& echo "✅ opened $$URL on adb target" \
			|| echo "⚠️  adb am start failed"; \
	else \
		echo "⚠️  adb not in PATH"; \
	fi

# ════════════════════════════════════════════════════════════
#  清理
# ════════════════════════════════════════════════════════════

clean-android:
	rm -rf $(ANDROID_DIR)/app/.cxx
	rm -rf $(ANDROID_DIR)/app/build
	-cd $(ANDROID_DIR) && ./gradlew clean

# ════════════════════════════════════════════════════════════
#  模拟器
# ════════════════════════════════════════════════════════════

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
#  截图
# ════════════════════════════════════════════════════════════

screenshot-android:
	@device_count=$$(adb devices | awk 'NR>1 && $$2=="device"' | wc -l | tr -d ' '); \
	if [ "$$device_count" -eq 0 ]; then \
		echo "❌ 未检测到 adb 设备，请先启动模拟器或连接真机"; \
		exit 1; \
	fi; \
	if [ "$$device_count" -gt 1 ] && [ -z "$(ADB_SERIAL)" ]; then \
		echo "⚠️  检测到多台设备，请通过 ADB_SERIAL=<serial> 指定:"; \
		adb devices; \
		exit 1; \
	fi; \
	adb_args=""; \
	if [ -n "$(ADB_SERIAL)" ]; then adb_args="-s $(ADB_SERIAL)"; fi; \
	mkdir -p $(TARGET_DIR)/screenshots; \
	ts=$$(date +%Y%m%d-%H%M%S); \
	out="$(TARGET_DIR)/screenshots/android-$$ts.png"; \
	echo "▶ 截图中..."; \
	adb $$adb_args exec-out screencap -p > "$$out"; \
	if [ ! -s "$$out" ]; then \
		echo "❌ 截图失败，文件为空: $$out"; \
		rm -f "$$out"; \
		exit 1; \
	fi; \
	echo "✅ 截图 → $$out"

# ════════════════════════════════════════════════════════════
#  内部目标
# ════════════════════════════════════════════════════════════

_check-android-env:
	@test -n "$(ANDROID_KEYSTORE_PATH)"  || { echo "❌ ANDROID_KEYSTORE_PATH 未设置"; exit 1; }
	@test -n "$(ANDROID_KEY_ALIAS)"      || { echo "❌ ANDROID_KEY_ALIAS 未设置"; exit 1; }
	@test -n "$(ANDROID_STORE_PASSWORD)" || { echo "❌ ANDROID_STORE_PASSWORD 未设置"; exit 1; }
	@test -n "$(ANDROID_KEY_PASSWORD)"   || { echo "❌ ANDROID_KEY_PASSWORD 未设置"; exit 1; }
	@test -f "$(ANDROID_KEYSTORE_PATH)"  || { echo "❌ 密钥文件不存在: $(ANDROID_KEYSTORE_PATH)"; exit 1; }

_ensure-android-codegen:
	@if [ ! -d "$(ANDROID_DIR)/app/build/generated/autolinking" ]; then \
		echo "▶ Android codegen 缺失，执行 prebuild..."; \
		npx expo prebuild --platform android; \
	else \
		echo "✔ Android codegen 已就绪"; \
	fi

_sync-version-android:
	@echo "▶ 同步版本号到 Android..."
	@node scripts/sync-version-android.js

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
