#!/usr/bin/env bash
# 原生纯核心的跨平台 golden 样本运行器。
#
# 每个纯核心在 src/modules/expo-onebox/golden/ 下共享一份语言无关的契约文件。
# 三个运行器断言同一份文件：
#   - JS    : src/utils/*.test.ts        （随 make test 运行）
#   - Kotlin: JVM 单元测试               （本脚本；无需设备）
#   - Swift : 宿主 swiftc 二进制         （本脚本；无需模拟器）
#
# 两个原生运行器都不需要 emulator/simulator。请在 make prebuild 之后运行。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MOD="$ROOT/src/modules/expo-onebox"

echo "▶ Kotlin golden (JVM unit test)…"
( cd "$ROOT/android" && ./gradlew :expo-onebox:testDebugUnitTest --console=plain )

echo "▶ Swift golden (host swiftc)…"
TMP="$(mktemp -d)"
swiftc -parse-as-library \
  "$MOD/ios/core/UserinfoParser.swift" \
  "$MOD/ios/tests/UserinfoGoldenCheck.swift" \
  -o "$TMP/userinfo-golden"
"$TMP/userinfo-golden" "$MOD/golden/userinfo.json"
swiftc -parse-as-library \
  "$MOD/ios/core/Sha256.swift" \
  "$MOD/ios/tests/Sha256GoldenCheck.swift" \
  -o "$TMP/sha256-golden"
"$TMP/sha256-golden" "$MOD/golden/sha256.json"
swiftc -parse-as-library \
  "$MOD/ios/core/DnsParse.swift" \
  "$MOD/ios/tests/DnsParseGoldenCheck.swift" \
  -o "$TMP/dns-golden"
"$TMP/dns-golden" "$MOD/golden/dns-arecord.json"
swiftc -parse-as-library \
  "$MOD/ios/core/ExitGatewayParse.swift" \
  "$MOD/ios/tests/ExitGatewayGoldenCheck.swift" \
  -o "$TMP/exitgateway-golden"
"$TMP/exitgateway-golden" "$MOD/golden/exitgateway.json"
swiftc -parse-as-library \
  "$MOD/ios/core/DomainSuffix.swift" \
  "$MOD/ios/tests/DomainSuffixGoldenCheck.swift" \
  -o "$TMP/domain-suffix-golden"
"$TMP/domain-suffix-golden" "$MOD/golden/domain-suffix.json"

swiftc -parse-as-library \
  "$MOD/ios/core/HttpChunked.swift" \
  "$MOD/ios/tests/HttpChunkedGoldenCheck.swift" \
  -o "$TMP/http-chunked-golden"
"$TMP/http-chunked-golden" "$MOD/golden/http-chunked.json"

echo "✅ native golden runners passed"
