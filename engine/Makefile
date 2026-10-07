# 引擎构建管线：上游内核源码 → 两端原生库，落位到 android/app/libs 与 ios/。
# 命名门禁豁免：本目录（engine/）允许出现上游 URL/包名/符号。
#
# 单一来源：UPSTREAM_TAG 是上游内核版本 tag 的唯一声明处（全仓其余任何文件不写明文 URL/tag）。
# 升级 = 只改此处 tag，再 `make engine`。
#
# target 名与根 Makefile 的 dispatch 对齐：android / apple / clean
# （根 Makefile：engine-android → $(MAKE) -C engine android；engine-apple → apple）。

UPSTREAM_TAG  := v1.14.2
UPSTREAM_REPO := https://github.com/SagerNet/sing-box.git
UPSTREAM_DIR  := upstream
BUILD_ENTRY   := cmd/internal/build_libbox

# 新 Go 工具链默认开 jsonv2 实验，上游间接依赖的 go-json-experiment 在该实验下引用已改名的
# 标准库符号而编译失败；关掉实验即回到上游 go.mod 声明的语义，与本机装的是哪个 Go 无关。
export GOEXPERIMENT := nojsonv2

# gomobile bind 的 Android ABI 列表（可覆盖）。默认单 arm64：Apple Silicon 模拟器与
# 真机都是 arm64-v8a，单 ABI 最快出可运行产物。发布/多 ABI 覆盖示例：
#   make -C engine android ANDROID_PLATFORM=android/arm64,android/amd64
ANDROID_PLATFORM ?= android/arm64

# 出货包的 ABI（Android 命名）。与上一代商店包一致：32 位 ARM 机型若被漏掉，商店会对它们静默停更。
# Gradle release 的 abiFilters 读的也是这一行（单一来源）；android-release 按它编全部 ABI。
ANDROID_RELEASE_ABIS := armeabi-v7a arm64-v8a
GOMOBILE_PLATFORM_armeabi-v7a := android/arm
GOMOBILE_PLATFORM_arm64-v8a   := android/arm64
comma := ,
empty :=
space := $(empty) $(empty)
ANDROID_RELEASE_PLATFORM := $(subst $(space),$(comma),$(foreach abi,$(ANDROID_RELEASE_ABIS),$(GOMOBILE_PLATFORM_$(abi))))

# Android cronet-go 静态库：每 ABI 一个 Go module，内含 libcronet.a。
# gomobile bind 期由 cgo 静态链接；ensure-cronet 自愈缺失/损坏的 .a（见下）。
CRONET_ANDROID_MODULES := \
	github.com/sagernet/cronet-go/lib/android_386 \
	github.com/sagernet/cronet-go/lib/android_amd64 \
	github.com/sagernet/cronet-go/lib/android_arm \
	github.com/sagernet/cronet-go/lib/android_arm64

ANDROID_LIBS_DIR := ../android/app/libs
IOS_DIR          := ../ios

.PHONY: android android-release apple clean clone inject ensure-cronet

# ── clone：浅克隆上游内核到 upstream/（gitignored）。已存在则跳过。 ──
clone:
	@if [ ! -d $(UPSTREAM_DIR)/.git ]; then \
		echo "cloning $(UPSTREAM_TAG) …"; \
		git clone --depth 1 --branch $(UPSTREAM_TAG) $(UPSTREAM_REPO) $(UPSTREAM_DIR); \
	else \
		echo "upstream present — skip clone (make clean 可重置)"; \
	fi

# ── inject：把自定义构建入口覆盖上游默认入口（单文件包，干净替换）。 ──
inject: clone
	cp main.go $(UPSTREAM_DIR)/$(BUILD_ENTRY)/main.go

# ── ensure-cronet：自愈 Go module cache 中的 android libcronet.a。 ──
# .a 偶因解压缓存损坏而缺失；据模块版本从 Go 下载缓存 zip 重解压并校验，缺失即 fail（不静默兜底）。
# 未下载的模块也在此触发下载（go mod download）。
ensure-cronet: clone
	@set -eu; \
	cd $(UPSTREAM_DIR); \
	gomodcache=$$(go env GOMODCACHE); \
	for module in $(CRONET_ANDROID_MODULES); do \
		version=$$(go list -m -f '{{.Version}}' "$$module"); \
		dir="$$gomodcache/$$module@$$version"; \
		if [ -f "$$dir/libcronet.a" ]; then \
			echo "cronet cache ok: $$module@$$version"; \
			continue; \
		fi; \
		echo "repairing cronet cache: $$module@$$version"; \
		zip=$$(go mod download -json "$$module@$$version" | sed -n 's/^[[:space:]]*"Zip":[[:space:]]*"\(.*\)",/\1/p'); \
		if [ -z "$$zip" ] || [ ! -f "$$zip" ]; then \
			echo "missing module zip for $$module@$$version"; exit 1; \
		fi; \
		if ! unzip -l "$$zip" "$$module@$$version/libcronet.a" >/dev/null; then \
			echo "module zip does not contain libcronet.a: $$module@$$version"; exit 1; \
		fi; \
		if [ -d "$$dir" ]; then chmod -R u+w "$$dir"; fi; \
		unzip -q -o "$$zip" "$$module@$$version/*" -d "$$gomodcache"; \
		if [ ! -f "$$dir/libcronet.a" ]; then echo "failed to repair libcronet.a: $$dir"; exit 1; fi; \
		chmod -R u-w "$$dir"; \
	done

# ── android：产 android/app/libs/engine.aar（-javapkg cloud.oneoh 由 main.go 施加）。 ──
android: inject ensure-cronet
	mkdir -p $(ANDROID_LIBS_DIR)
	cd $(UPSTREAM_DIR) && go run ./$(BUILD_ENTRY) -target android -platform "$(ANDROID_PLATFORM)"
	deno run --allow-read --allow-write --allow-run=unzip,zip android-artifact.ts \
		optimize-libbox-aar $(UPSTREAM_DIR)/engine.aar $(ANDROID_LIBS_DIR)/engine.aar

# ── android-release：出货用，覆盖 ANDROID_RELEASE_ABIS 的全部 ABI。 ──
android-release:
	$(MAKE) android ANDROID_PLATFORM="$(ANDROID_RELEASE_PLATFORM)"

# ── apple：产静态中间件，再装配为 app 与扩展共享的动态 EngineKit。 ──
# 注：apple cronet 用 lib/darwin_* / lib/ios_* 模块，由 gomobile 正常下载；如遇同类 .a
# 缺失自愈需求，比照 ensure-cronet 扩展 darwin/ios 模块列表。
apple: inject
	mkdir -p $(IOS_DIR)
	cd $(UPSTREAM_DIR) && go run ./$(BUILD_ENTRY) -target apple
	deno run --allow-read --allow-write --allow-run=xcrun,xcodebuild,plutil apple-artifact.ts \
		package-dynamic-engine $(IOS_DIR)/Engine.xcframework $(IOS_DIR)/EngineKit

# ── clean：重置 clone 工作区与已落位产物。 ──
clean:
	rm -rf $(UPSTREAM_DIR)
	rm -f $(ANDROID_LIBS_DIR)/engine.aar
	rm -rf $(IOS_DIR)/Engine.xcframework
	rm -rf $(IOS_DIR)/EngineKit/EngineLink.xcframework
	rm -f $(IOS_DIR)/EngineKit/Sources/EngineKit/include/EngineFFI.h
	rm -f $(IOS_DIR)/EngineKit/Sources/EngineKit/include/Libbox.objc.h
	rm -f $(IOS_DIR)/EngineKit/Sources/EngineKit/include/Universe.objc.h
	rm -f $(IOS_DIR)/EngineKit/Sources/EngineKit/include/ref.h
