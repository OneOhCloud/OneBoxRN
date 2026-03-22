# Android 后台任务不执行问题排查与修复

> 日期：2026-03-22
> 涉及文件：`src/tasks/config-refresh.ts`、`src/app/config/dev.tsx`

## 问题现象

开发者工具页面的 **Execution History** 显示过去数天内没有任何后台任务执行记录。任务应每 ~15 分钟由系统调度执行一次，自动刷新订阅配置。

---

## 技术背景

### expo-background-task 在 Android 上的工作原理

```
App 启动 → registerTaskAsync() → WorkManager 入队 OneTimeWorkRequest（15 分钟延迟）
                                         ↓
                              延迟到期 + 约束满足 → doWork() → runTasks() → JS 任务体执行
                                         ↓
                              任务完成 → 再次入队新的 OneTimeWorkRequest（循环）
```

关键实现细节（源码位于 `node_modules/expo-background-task/android/`）：

1. **OneTimeWorkRequest，不是 PeriodicWorkRequest**
   `BackgroundTaskScheduler.kt` 在 Android O+（API 26+，即所有现代设备）上使用 `OneTimeWorkRequestBuilder` 而非 `PeriodicWorkRequestBuilder`。每次任务执行完毕后，由调度器手动再次入队下一次任务，形成自循环链条。

2. **网络约束**
   WorkManager 任务设置了 `NetworkType.CONNECTED` 约束，要求设备具有已验证的网络连接（`INTERNET & TRUSTED & VALIDATED`）。

3. **前台检查**
   `BackgroundTaskScheduler` 维护了一个内存中的 `inForeground` 标志位。当 Activity 进入前台时设为 `true`，进入后台时设为 `false`。`runTasks()` 方法在 `inForeground == true` 时会**跳过任务执行**，仅重新调度。

---

## 根因分析

通过 Android Studio 模拟器（Pixel 9）实际测试，结合 `adb logcat` 和 `adb shell dumpsys jobscheduler` 输出，定位了以下三个根因：

### 根因 1：force-stop 导致 WorkManager 任务永久取消

**这是最主要的原因。**

当用户在最近任务列表中上滑关闭应用时，许多 Android 设备会执行 `am force-stop`。这会**永久取消所有已注册的 WorkManager 任务**。

验证过程：

```bash
# 强制停止应用
adb shell am force-stop cloud.oneoh.networktools

# 检查 WorkManager 任务 → 已消失
adb shell dumpsys jobscheduler | grep "cloud.oneoh"
# 结果：不再有 JOB 条目
```

而旧代码在 `registerConfigRefreshTask()` 中的逻辑是：

```typescript
// 旧逻辑（有问题）
const isRegistered = await TaskManager.isTaskRegisteredAsync(CONFIG_REFRESH_TASK);
if (!isRegistered) {
    await BackgroundTask.registerTaskAsync(...);  // 只在未注册时注册
}
```

问题在于 `isTaskRegisteredAsync()` 检查的是 **Expo TaskManager 的持久化注册表**（存储在 SharedPreferences 中），而不是 WorkManager 的实际任务队列。即使 WorkManager 任务已被 force-stop 取消，`isTaskRegisteredAsync()` 仍然返回 `true`，导致代码跳过注册，**永远不会创建新的 WorkManager 任务**。

```
TaskManager 注册表：config-refresh = true  ← 持久化的，force-stop 不影响
WorkManager 任务队列：(空)                  ← 被 force-stop 清除了
                                           ← 两者不一致！
```

### 根因 2：triggerTaskWorkerForTestingAsync 在前台不工作

`BackgroundTaskModule.kt` 中的测试触发方法直接调用 `BackgroundTaskScheduler.runTasks()`，但 `runTasks()` 内部检查 `inForeground`：

```kotlin
// BackgroundTaskScheduler.kt:206-216
if (inForeground) {
    // 跳过执行，仅重新调度
    scheduleWorker(context, appScopeKey, false, 60L.coerceAtMost(intervalMinutes))
    return  // ← 直接返回，不执行任务！
}
```

这意味着在 Dev 页面点击测试按钮时（应用必然在前台），任务**永远不会执行**，只会静默重新调度。logcat 输出证实了这一点：

```
BackgroundTaskScheduler: runTasks: number of consumers 1
BackgroundTaskScheduler: runTasks: App is in the foreground    ← 跳过执行
BackgroundTaskScheduler: Enqueuing worker with identifier EXPO_BACKGROUND_WORKER and '15' minutes delay.
```

### 根因 3：Dev 模式下进程被杀后 Headless JS 加载失败

当应用进程被系统回收后，WorkManager 会重启进程并以 headless 模式加载 JS bundle。在开发模式下，JS bundle 需要从 Metro 服务器（`10.0.2.2:8081`）加载，但 headless 进程可能无法连接到 Metro：

```
ReactNativeJS: No task registered for key expo-task-manager  ← defineTask 未执行
ReactNativeJS: Cannot connect to Expo CLI.
ReactNativeJS: URL: 10.0.2.2:8081
```

`TaskManager.defineTask()` 是在 `config-refresh.ts` 的模块顶层调用的，但如果 JS bundle 未成功加载，这段代码就不会执行。

> 注意：这仅影响开发模式。生产构建中 JS bundle 已内嵌在 APK 中，headless 加载不依赖 Metro。

---

## 修复方案

### 修复 1：每次启动都重新注册任务

将 `registerConfigRefreshTask()` 改为**始终 unregister + register**，确保每次应用打开时都创建一个新的 WorkManager 任务：

```typescript
// 新逻辑
export async function registerConfigRefreshTask() {
    const status = await BackgroundTask.getStatusAsync();
    if (status === BackgroundTask.BackgroundTaskStatus.Restricted) return;

    const isRegistered = await TaskManager.isTaskRegisteredAsync(CONFIG_REFRESH_TASK);
    if (isRegistered) {
        await BackgroundTask.unregisterTaskAsync(CONFIG_REFRESH_TASK);
        // 清理可能已被 force-stop 取消的旧注册
    }
    await BackgroundTask.registerTaskAsync(CONFIG_REFRESH_TASK, {
        minimumInterval: 15,
    });
}
```

这样即使用户上滑关闭了应用，下次打开时也会自动恢复后台任务调度。

### 修复 2：提取任务体，支持前台直接调用

将任务逻辑提取为独立的 `executeConfigRefresh()` 函数：

```typescript
export async function executeConfigRefresh(): Promise<BackgroundTaskResult> {
    // ... 原有的 fetch + 更新逻辑
}

// 后台调度入口
TaskManager.defineTask(CONFIG_REFRESH_TASK, async () => {
    return executeConfigRefresh();
});
```

Dev 页面的 "Run Task Now" 按钮直接调用 `executeConfigRefresh()`，绕过 `BackgroundTaskScheduler` 的 `inForeground` 检查，使开发者能在前台测试任务逻辑。

### 修复 3：添加诊断日志

在注册和执行的关键路径添加了 `console.log`，方便通过 `adb logcat | grep ConfigRefresh` 快速定位问题。

---

## 验证结果

在 Android 模拟器（Pixel 9, API 35）上的完整测试流程：

| 测试场景 | 结果 |
|---------|------|
| 应用启动 → 注册任务 | `task registered successfully`，WorkManager 任务入队 |
| 应用在后台 → 强制触发 WorkManager 任务 | 任务成功执行，config 更新，自动重新调度 |
| 应用在前台 → Dev 页面点击 "Run Task Now" | `executeConfigRefresh()` 直接执行，返回 Success |
| `am force-stop` → 重新打开应用 | 旧任务已清除，新任务重新注册成功 |
| 进程被 kill → WorkManager 触发（dev 模式） | JS bundle 加载失败（Metro 不可达）—— 仅 dev 模式问题 |

**关键 adb 命令参考：**

```bash
# 查看 WorkManager 任务状态
adb shell dumpsys jobscheduler | grep -A 15 "cloud.oneoh"

# 强制触发任务（需要先通过上面的命令获取 JOB_ID 和 namespace）
adb shell cmd jobscheduler run -f -n "androidx.work.systemjobscheduler" cloud.oneoh.networktools <JOB_ID>

# 查看 React Native JS 日志
adb logcat | grep "ReactNativeJS.*ConfigRefresh"

# 查看原生侧后台任务日志
adb logcat | grep "BackgroundTaskScheduler\|BackgroundTaskConsumer\|BackgroundTaskWork"
```

---

## Android 后台任务的平台限制

以下是无法通过代码解决的平台限制，需要用户知悉：

1. **最小间隔 15 分钟** —— WorkManager 的硬性限制，无法缩短。
2. **系统调度不精确** —— 15 分钟是最小延迟，实际触发时间由系统决定，可能更晚。
3. **force-stop 取消所有任务** —— Android 设计如此，只能在下次打开应用时恢复。
4. **厂商定制限制** —— 部分厂商（小米、华为、OPPO 等）的系统会激进地杀死后台进程和清理 WorkManager 任务。详见 [dontkillmyapp.com](https://dontkillmyapp.com)。
5. **Doze 模式** —— 设备长时间静止不充电时，系统会延迟所有后台任务直到下一个维护窗口。
6. **网络约束** —— expo-background-task 硬编码了 `NetworkType.CONNECTED` 约束，在无网络时任务不会执行。
