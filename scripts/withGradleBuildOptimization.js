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
 * 7. Configuration on demand — only configure relevant projects
 * 8. Kotlin daemon JVM args — match memory for Kotlin compilation
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
      'org.gradle.configuration-cache': 'true',

      // ── File System Watching (avoid full FS scan on each build) ──
      'org.gradle.vfs.watch': 'true',

      // ── Configure On Demand (only configure touched projects) ──
      'org.gradle.configureondemand': 'true',

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
