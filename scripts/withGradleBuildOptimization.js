const { withGradleProperties } = require('@expo/config-plugins');

/**
 * Expo Config Plugin: Gradle build performance optimization.
 *
 * Optimizations applied:
 * 1. JVM memory — 8GB heap + 2GB metaspace, avoid OOM & daemon restart
 * 2. Parallel execution — build independent modules concurrently
 * 3. Configuration cache — skip re-evaluating build scripts when nothing changed
 * 4. Build cache — reuse task outputs across builds
 * 5. Caching — enable org.gradle.caching for incremental builds
 * 6. File system watching — continuous monitoring avoids full re-scan
 * 7. Kotlin daemon JVM args — match memory for Kotlin compilation
 *
 * NOTE: org.gradle.configureondemand is intentionally NOT set. It is
 * unsupported by the Android Gradle Plugin and the React Native Gradle
 * Plugin: it lazily configures only "touched" projects and drops the
 * task-dependency edges that wire codegen (BuildConfig, R.jar,
 * autolinking PackageList.java / autolinking.h) ahead of the :app
 * compile/CMake tasks. With it on, the consumers race ahead of the
 * generators and the build fails non-deterministically with
 * "Unresolved reference 'BuildConfig'", missing R.jar, and
 * "'autolinking.h' file not found".
 */
module.exports = function withGradleBuildOptimization(config) {
  return withGradleProperties(config, (config) => {
    const props = config.modResults;

    const optimizations = {
      // ── JVM Memory ──
      'org.gradle.jvmargs':
        '-Xmx8192m -XX:MaxMetaspaceSize=2048m -XX:+HeapDumpOnOutOfMemoryError',

      // ── Parallelism ──
      'org.gradle.parallel': 'true',
      'org.gradle.workers.max': String(Math.max(4, require('os').cpus().length)),

      // ── Caching ──
      'org.gradle.caching': 'true',
      'org.gradle.configuration-cache': 'false',

      // ── File System Watching (avoid full FS scan on each build) ──
      'org.gradle.vfs.watch': 'true',

      // ── Kotlin Compilation ──
      'kotlin.daemon.jvmargs':
        '-Xmx4096m -XX:MaxMetaspaceSize=1024m',
      'kotlin.incremental': 'true',

      // ── Suppress Daemon Performance Warning ──
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
