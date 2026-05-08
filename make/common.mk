.PHONY: prebuild prebuild-android prebuild-ios _prebuild-cache-hint \
        sync-templates _sync-templates \
        update-tun-db _update-tun-db \
        sync-s3 \
        open-android open-ios \
        clean

# ════════════════════════════════════════════════════════════
#  默认配置模板同步（conf-template → src/database/template/generated.ts）
# ════════════════════════════════════════════════════════════

## 强制从 conf-template 拉取最新模板，覆写 generated.ts
sync-templates:
	@npm run sync-templates --silent

## 内部依赖目标：首次/缺失时生成，已存在则跳过，避免每次构建都打网络。
## generated.ts 已列入 .gitignore，npm install 的 postinstall 会兜底生成。
_sync-templates:
	@if [ ! -f src/database/template/generated.ts ]; then \
		echo "▶ generated.ts 不存在，从 conf-template 同步..."; \
		npm run sync-templates --silent; \
	else \
		echo "✔ generated.ts 已存在（运行 'make sync-templates' 可强制刷新）"; \
	fi

# ════════════════════════════════════════════════════════════
#  Prebuild
# ════════════════════════════════════════════════════════════

# --no-install skips expo's built-in pod install.
# _ensure-pods (in ios.mk) runs pod install.
prebuild: _sync-templates
	npx expo prebuild --clean --no-install
	@$(MAKE) _prebuild-cache-hint

prebuild-android: _sync-templates
	npx expo prebuild --platform android --clean
	@$(MAKE) _prebuild-cache-hint

prebuild-ios: _sync-templates
	npx expo prebuild --platform ios --clean --no-install
	@$(MAKE) _prebuild-cache-hint

# prebuild 仅重建工程脚手架，不清 Xcode/Gradle 缓存。
# 原生二进制更新（Libbox.xcframework / libbox.aar / 任何 .a/.so）后必须手动清缓存，
# 否则 Xcode 的 ModuleCache（PCM）和 Gradle build cache 会继续使用旧符号。
_prebuild-cache-hint:
	@echo ""
	@echo "⚠️  prebuild 只重建了 ios/ 与 android/ 工程脚手架，未清 Xcode / Gradle 缓存。"
	@echo "   若你刚刚重新构建了原生二进制（Libbox.xcframework / libbox.aar 等），"
	@echo "   请执行以下任一命令，避免使用旧 PCM / build cache 中的过期符号："
	@echo "     • make clean-ios       # 清 Pods + ios/build + DerivedData(含 ModuleCache)"
	@echo "     • make clean-android   # 清 .cxx + app/build"
	@echo "     • make clean           # 两端一起清"
	@echo ""

# ════════════════════════════════════════════════════════════
#  tun.db
# ════════════════════════════════════════════════════════════

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

# ════════════════════════════════════════════════════════════
#  S3 同步
# ════════════════════════════════════════════════════════════

sync-s3:
	@bash scripts/sync-s3.sh

# ════════════════════════════════════════════════════════════
#  IDE
# ════════════════════════════════════════════════════════════

open-android:
	open -a "Android Studio" $(ANDROID_DIR)

open-ios:
	open $(IOS_WORKSPACE)

# ════════════════════════════════════════════════════════════
#  清理（依赖各平台子目标）
# ════════════════════════════════════════════════════════════

clean: clean-android clean-ios
	@echo "✅ 清理完成"
