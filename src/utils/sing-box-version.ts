/**
 * sing-box 版本的单一运行时来源。
 *
 * `ExpoOneBox.getLibBoxVersion()` 是权威取值口 —— 它返回 Libbox 编译时所用
 * 的版本（由 src/modules/expo-onebox/helper/Makefile 里的 SING_BOX_TAG 驱动，
 * gomobile 构建把它烤进二进制）。始终调用这些辅助函数，别手工维护一个平行的
 * 版本常量，那只会招致漂移。
 *
 * 输出是裸的 `MAJOR.MINOR.PATCH`（无 `v` 前缀），与原生取值口一致 —— 拿字面量
 * 比较的调用方不要带 `v`。
 */

import ExpoOneBox from '@/modules/expo-onebox';

/**
 * 链接进来的 Libbox 报告的裸 `MAJOR.MINOR.PATCH` 版本。
 * 原生取值口不加 `v` 前缀 —— 想要展示形态（例如 `v1.13.8-<commit>`）的
 * 调用方自行前置。原生模块离线时返回 `'0.0.0'` 作为安全下限（让下游的
 * split 调用始终成立）。
 */
export function getSingBoxVersion(): string {
    return ExpoOneBox.getLibBoxVersion() || '0.0.0';
}

/**
 * 运行中 Libbox 的 `MAJOR.MINOR` —— 例如 `1.13.8` 得到 `"1.13"`。
 * 用作 cache-key 的一段，使配置缓存在同一 sing-box minor 线内存活、
 * 跨 minor 时重置。
 */
export function getSingBoxMajorVersion(): string {
    const [major = '0', minor = '0'] = getSingBoxVersion().split('.');
    return `${major}.${minor}`;
}
