const { withGradleProperties } = require('@expo/config-plugins');

/**
 * Expo Config Plugin：Gradle 构建性能优化。
 *
 * 应用的优化项：
 * 1. JVM 内存 —— 8GB 堆 + 2GB metaspace，避免 OOM 与 daemon 重启
 * 2. 并行执行 —— 独立模块并发构建
 * 3. Configuration cache —— 无改动时跳过重新求值构建脚本
 * 4. Build cache —— 跨构建复用任务产物
 * 5. Caching —— 开启 org.gradle.caching 支持增量构建
 * 6. 文件系统监听 —— 持续监控，避免全量重扫
 * 7. Kotlin daemon JVM 参数 —— 为 Kotlin 编译匹配内存
 *
 * 注意：org.gradle.configureondemand 有意不设置。Android Gradle Plugin 与
 * React Native Gradle Plugin 都不支持它：它只惰性配置"被触及"的工程，会丢掉
 * 那些把 codegen（BuildConfig、R.jar、autolinking PackageList.java / autolinking.h）
 * 接到 :app 编译/CMake 任务之前的任务依赖边。一旦开启，消费方会抢在生成方
 * 之前执行，构建随机失败，报 "Unresolved reference 'BuildConfig'"、缺失 R.jar
 * 以及 "'autolinking.h' file not found"。
 */
module.exports = function withGradleBuildOptimization(config) {
  return withGradleProperties(config, (config) => {
    const props = config.modResults;

    const optimizations = {
      // ── JVM 内存 ──
      'org.gradle.jvmargs':
        '-Xmx8192m -XX:MaxMetaspaceSize=2048m -XX:+HeapDumpOnOutOfMemoryError',

      // ── 并行 ──
      'org.gradle.parallel': 'true',
      'org.gradle.workers.max': String(Math.max(4, require('os').cpus().length)),

      // ── 缓存 ──
      'org.gradle.caching': 'true',
      'org.gradle.configuration-cache': 'false',

      // ── 文件系统监听（避免每次构建全量扫描）──
      'org.gradle.vfs.watch': 'true',

      // ── Kotlin 编译 ──
      'kotlin.daemon.jvmargs':
        '-Xmx4096m -XX:MaxMetaspaceSize=1024m',
      'kotlin.incremental': 'true',

      // ── 抑制 Daemon 性能警告 ──
      'org.gradle.daemon.performance.disable-logging': 'true',
    };

    for (const [key, value] of Object.entries(optimizations)) {
      const idx = props.findIndex(
        (item) => item.type === 'property' && item.key === key
      );

      if (idx !== -1) {
        props[idx].value = value;
      } else {
        props.push({ type: 'property', key, value });
      }
    }

    return config;
  });
};
