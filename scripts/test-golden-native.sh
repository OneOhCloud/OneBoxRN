#!/usr/bin/env bash
# Cross-platform golden-sample runners for the native pure cores (audit Batch 3).
#
# The pure cores share one language-agnostic contract file per core under
# src/modules/expo-onebox/golden/. Three runners assert against the SAME file:
#   - JS    : src/utils/*.test.ts        (runs under `make test`)
#   - Kotlin: JVM unit test              (this script; no device)
#   - Swift : host `swiftc` binary       (this script; no simulator)
#
# Neither native runner needs an emulator/simulator. Run after `make prebuild`.
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

echo "✅ native golden runners passed"
