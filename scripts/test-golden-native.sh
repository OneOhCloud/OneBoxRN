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
BIN="$(mktemp -d)/userinfo-golden"
swiftc -parse-as-library \
  "$MOD/ios/core/UserinfoParser.swift" \
  "$MOD/ios/tests/UserinfoGoldenCheck.swift" \
  -o "$BIN"
"$BIN" "$MOD/golden/userinfo.json"

echo "✅ native golden runners passed"
