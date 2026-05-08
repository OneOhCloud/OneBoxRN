.PHONY: ios ios-archive \
        run-ios dev-smoke-ios \
        crash-ios \
        clean-ios \
        _check-ios-env _ensure-pods pods-update \
        _inject-ios-team _sync-version-ios

# ════════════════════════════════════════════════════════════
#  构建
# ════════════════════════════════════════════════════════════

ios: ios-archive

ios-archive: _check-ios-env _sync-templates _update-tun-db _sync-version-ios _ensure-pods _inject-ios-team
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
	$(eval ARCHIVE_DATE := $(shell date +%Y-%m-%d))
	$(eval ARCHIVE_NAME := $(APP_NAME) $(shell date +"%Y-%m-%d %H.%M.%S"))
	@mkdir -p "$(XCODE_ARCHIVES)/$(ARCHIVE_DATE)"
	@cp -R "$(TARGET_DIR)/$(APP_NAME).xcarchive" \
		"$(XCODE_ARCHIVES)/$(ARCHIVE_DATE)/$(ARCHIVE_NAME).xcarchive"
	@echo "✅ Archive → $(TARGET_DIR)/$(APP_NAME).xcarchive"
	@echo "✅ 已同步 → $(XCODE_ARCHIVES)/$(ARCHIVE_DATE)/"

# ════════════════════════════════════════════════════════════
#  开发调试
# ════════════════════════════════════════════════════════════

run-ios: _check-ios-env _sync-templates _update-tun-db _ensure-pods _inject-ios-team
	@echo ""
	@echo "  ────────────────────────────────────────────────────────────"
	@echo "  Once you see 'iOS Bundled …ms' in the Metro output below,"
	@echo "  run this in another terminal to trigger the import smoke check:"
	@echo ""
	@echo "      make dev-smoke-ios"
	@echo "  ────────────────────────────────────────────────────────────"
	@echo ""
	npx expo run:ios --device

# Fire the /dev-smoke deep link on whichever iOS target is available.
# Tries the booted simulator first, falls back to a connected device via
# devicectl (Xcode 15+). Safe to call manually any time the app is
# running — just navigates to the Import Smoke Check page.
dev-smoke-ios:
	@URL="oneoh-networktools://dev-smoke"; \
	if xcrun simctl list devices 2>/dev/null | grep -q "Booted"; then \
		xcrun simctl openurl booted "$$URL" \
			&& echo "✅ opened $$URL on booted simulator" \
			|| echo "⚠️  simctl openurl failed"; \
	elif command -v xcrun >/dev/null 2>&1 && xcrun devicectl --help >/dev/null 2>&1; then \
		UDID=$$(xcrun devicectl list devices 2>/dev/null | awk '/connected/ {print $$3; exit}'); \
		if [ -n "$$UDID" ]; then \
			xcrun devicectl device open url --device "$$UDID" "$$URL" \
				&& echo "✅ opened $$URL on device $$UDID" \
				|| echo "⚠️  devicectl open failed"; \
		else \
			echo "⚠️  no connected device found"; \
		fi; \
	else \
		echo "⚠️  neither a booted simulator nor devicectl is available"; \
	fi

# 解析 iOS 崩溃日志，输出“真实错误”摘要与关键线程栈。
# 用法:
#   make crash-ios CRASH=/path/to/report.crash
#   make crash-ios CRASH=/path/to/SomePoint.xccrashpoint
crash-ios:
	@test -n "$(CRASH)" || { \
		echo "❌ 请传入 CRASH 路径"; \
		echo "   示例: make crash-ios CRASH=/path/to/report.crash"; \
		exit 1; \
	}
	@bash scripts/ios-crash-report.sh "$(CRASH)"

# ════════════════════════════════════════════════════════════
#  清理
# ════════════════════════════════════════════════════════════

clean-ios:
	rm -rf $(TARGET_DIR)/$(APP_NAME).xcarchive
	rm -rf ios/Pods
	rm -rf ios/build
	rm -rf $(IOS_DERIVED_DATA)
	# Xcode IDE 在工程被打开时会另建一份 DerivedData（含 SourceKit 索引、SwiftExplicitPrecompiledModules
	# PCM 缓存）；它独立于 -derivedDataPath，stale PCM 会让 archive 看到旧 ObjC 协议签名（issue #lib-pcm-stale）。
	rm -rf ~/Library/Developer/Xcode/DerivedData/$(APP_NAME)-*

# ════════════════════════════════════════════════════════════
#  内部目标
# ════════════════════════════════════════════════════════════

_check-ios-env:
	@test -n "$(IOS_TEAM_ID)"  || { echo "❌ IOS_TEAM_ID 未设置"; exit 1; }
	@test -f "$(EXPORT_PLIST)" || { echo "❌ 找不到 $(EXPORT_PLIST)"; exit 1; }

_ensure-pods:
	@if [ ! -d "ios/Pods" ] || [ "ios/Podfile.lock" -ot "package.json" ]; then \
		echo "▶ Pods 缺失或可能过期，执行 pod install..."; \
		cd ios && pod install --no-repo-update; \
	else \
		echo "✔ Pods 已就绪"; \
	fi

# 显式更新 spec repo 后重新安装（添加新 pod 时使用）
pods-update:
	cd ios && pod install --repo-update

_inject-ios-team:
	@echo "▶ 确保 Xcode 项目包含 DEVELOPMENT_TEAM..."
	@node scripts/inject-ios-team.js "$(IOS_TEAM_ID)" "$(APP_NAME)"

_sync-version-ios:
	@echo "▶ 同步版本号到 iOS..."
	@node scripts/sync-version-ios.js "$(APP_NAME)"
