.PHONY: test test-bg-worker test-bg-trigger adb-logcat-bg

# ════════════════════════════════════════════════════════════
#  JS/TS 单元测试
# ════════════════════════════════════════════════════════════

## 运行仓库内的单元测试（node:test + --experimental-strip-types）
## 本项目未配置 CI，提交前执行此目标作为本地回归。
test:
	@npm test

# WorkManager 在 Android 12+ 通过此 namespace 注册 Job
BG_NS        := androidx.work.systemjobscheduler
BG_SVC       := androidx.work.impl.background.systemjob.SystemJobService
BG_WORK_NAME := cloud.oneoh.networktools.config-refresh
BG_WM_DB     := /data/data/$(PKG)/no_backup/androidx.work.workdb
BG_WM_TMP    := /data/local/tmp/$(PKG)_wm.db
BG_LOCAL_TMP := /tmp/$(PKG)_wm.db

# 从 dumpsys jobscheduler 动态提取 WorkManager Job ID
_bg-job-id = $(shell \
	adb shell dumpsys jobscheduler 2>/dev/null \
	| grep "JOB $(BG_NS).*$(PKG)/$(BG_SVC)" \
	| sed 's/.*u0a[0-9]*\/\([0-9]*\):.*/\1/' \
	| head -1)

# ════════════════════════════════════════════════════════════
#  ADB 后台 Worker 测试
# ════════════════════════════════════════════════════════════

## 触发后台 Worker 并验证 doWork() 执行结果
## force-stop → 重启 App（WorkManager 重建 work spec，period_start_ms 归零）→ 触发
## 前提：已连接设备、App 已运行且已导入 profile
test-bg-worker:
	@adb get-state >/dev/null 2>&1 || { echo "❌ 未找到 ADB 设备"; exit 1; }
	@echo "▶ 停止 App..."; \
	adb shell am force-stop $(PKG); \
	echo "▶ 重置 WorkManager 调度时间..."; \
	adb shell "run-as $(PKG) cat $(BG_WM_DB)" > $(BG_LOCAL_TMP) 2>/dev/null || { \
		echo "❌ 无法读取 WorkManager DB（App 未注册后台任务？）"; exit 1; \
	}; \
	sqlite3 $(BG_LOCAL_TMP) \
	  "UPDATE workspec SET last_enqueue_time=0 WHERE id IN (SELECT id FROM workname WHERE name='$(BG_WORK_NAME)')"; \
	adb push $(BG_LOCAL_TMP) $(BG_WM_TMP) >/dev/null 2>&1; \
	adb shell run-as $(PKG) cp $(BG_WM_TMP) $(BG_WM_DB); \
	adb shell run-as $(PKG) rm -f $(BG_WM_DB)-wal $(BG_WM_DB)-shm; \
	adb shell rm -f $(BG_WM_TMP); \
	rm -f $(BG_LOCAL_TMP); \
	echo "  ✓ last_enqueue_time 已归零，WAL 已清除"; \
	echo "▶ 启动 App..."; \
	adb shell monkey -p $(PKG) -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; \
	echo "▶ 等待 WorkManager Job 注册（最多 15s）..."; \
	WAIT=0; \
	while [ $$WAIT -lt 15 ]; do \
		JOB_ID="$(call _bg-job-id)"; \
		[ -n "$$JOB_ID" ] && break; \
		sleep 1; WAIT=$$((WAIT+1)); \
	done; \
	JOB_ID="$(call _bg-job-id)"; \
	if [ -z "$$JOB_ID" ]; then \
		echo "❌ WorkManager Job 未在 15s 内注册，请确认已导入 profile"; exit 1; \
	fi; \
	echo "  Job ID = $$JOB_ID"; \
	echo "▶ 清空 logcat..."; \
	adb logcat -c; \
	TMPLOG=$$(mktemp); \
	adb logcat > "$$TMPLOG" & \
	LOGCAT_PID=$$!; \
	sleep 1; \
	echo "▶ 触发后台 Worker..."; \
	adb shell cmd jobscheduler run -f -n $(BG_NS) $(PKG) $$JOB_ID; \
	echo "▶ 等待 doWork() 完成（最多 30s）..."; \
	DEADLINE=$$((SECONDS + 30)); \
	while [ $$SECONDS -lt $$DEADLINE ]; do \
		grep -q "CONFIG_LOAD\|No config URL\|not doing any work" "$$TMPLOG" 2>/dev/null && break; \
		sleep 0.5; \
	done; \
	kill $$LOGCAT_PID 2>/dev/null; wait $$LOGCAT_PID 2>/dev/null; \
	if grep -q "主URL成功\|加速回落成功" "$$TMPLOG"; then \
		echo "✅ doWork() 成功:"; \
		grep "\[CONFIG_LOAD\]" "$$TMPLOG"; \
	elif grep -q "not doing any work and rescheduling" "$$TMPLOG"; then \
		echo "❌ COOLDOWN：period_start_ms 未重置，重试一次 make test-bg-worker"; \
		rm -f "$$TMPLOG"; exit 2; \
	elif grep -q "No config URL" "$$TMPLOG"; then \
		echo "❌ doWork() 跳过：未注册后台任务或 config_url 为空"; \
		rm -f "$$TMPLOG"; exit 1; \
	else \
		echo "❌ doWork() 未在 30s 内返回结果（超时）"; \
		cat "$$TMPLOG"; \
		rm -f "$$TMPLOG"; exit 1; \
	fi; \
	rm -f "$$TMPLOG"

## 仅触发后台 Worker，不等待结果（快速调试）
test-bg-trigger:
	@adb get-state >/dev/null 2>&1 || { echo "❌ 未找到 ADB 设备"; exit 1; }
	@JOB_ID="$(call _bg-job-id)"; \
	if [ -z "$$JOB_ID" ]; then \
		echo "❌ 未找到 WorkManager Job"; exit 1; \
	fi; \
	echo "▶ 触发 Job ID=$$JOB_ID..."; \
	adb shell cmd jobscheduler run -f -n $(BG_NS) $(PKG) $$JOB_ID; \
	echo "  提示：运行 make adb-logcat-bg 查看实时日志"

## 实时查看后台 Worker 日志（Ctrl+C 退出）
adb-logcat-bg:
	adb logcat -s BackgroundConfigWorker:I
