#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "用法:"
  echo "  $0 <crash-file-or-dir>"
  echo ""
  echo "示例:"
  echo "  $0 /path/to/report.crash"
  echo "  $0 /path/to/some.xccrashpoint"
}

if [ "${1:-}" = "" ]; then
  usage
  exit 1
fi

INPUT_PATH="$1"

if [ ! -e "$INPUT_PATH" ]; then
  echo "❌ 路径不存在: $INPUT_PATH"
  exit 1
fi

pick_latest_crash_in_dir() {
  local dir="$1"
  local latest

  latest="$(
    find "$dir" -type f -name '*.crash' 2>/dev/null \
      | while IFS= read -r f; do
          ts="$(stat -f '%m' "$f" 2>/dev/null || true)"
          if [ -z "$ts" ]; then
            ts=0
          fi
          printf '%s\t%s\n' "$ts" "$f"
        done \
      | sort -nr \
      | head -n 1 \
      | sed 's/^[0-9][0-9]*[[:space:]]//'
  )"

  if [ -n "$latest" ] && [ -f "$latest" ]; then
    printf '%s\n' "$latest"
    return 0
  fi
  return 1
}

resolve_report() {
  local p="$1"
  if [ -f "$p" ]; then
    printf '%s\n' "$p"
    return 0
  fi

  if [ -d "$p" ]; then
    # Prefer Xcode's locally symbolicated crashes.
    if [ -d "$p/Filters" ]; then
      if latest="$(pick_latest_crash_in_dir "$p/Filters")"; then
        printf '%s\n' "$latest"
        return 0
      fi
    fi
    if latest="$(pick_latest_crash_in_dir "$p")"; then
      printf '%s\n' "$latest"
      return 0
    fi
  fi

  return 1
}

REPORT_PATH="$(resolve_report "$INPUT_PATH" || true)"
if [ -z "$REPORT_PATH" ]; then
  echo "❌ 未找到可解析的 .crash 文件: $INPUT_PATH"
  exit 1
fi

field() {
  local key="$1"
  awk -v k="$key" '
    index($0, k ":") == 1 {
      out = substr($0, length(k) + 2)
      sub(/^[[:space:]]+/, "", out)
      print out
      exit
    }
  ' "$REPORT_PATH"
}

APP_NAME="$(field "Process")"
EXCEPTION_TYPE="$(field "Exception Type")"
TERMINATION_REASON="$(field "Termination Reason")"
TRIGGERED_THREAD="$(field "Triggered by Thread")"
DATE_TIME="$(field "Date/Time")"
OS_VERSION="$(field "OS Version")"

if [ -z "$TRIGGERED_THREAD" ]; then
  TRIGGERED_THREAD="$(awk '/^Thread [0-9]+ Crashed:/{print $2; exit}' "$REPORT_PATH" || true)"
fi

echo "────────────────────────────────────────"
echo "iOS Crash 解析结果"
echo "────────────────────────────────────────"
echo "报告文件: $REPORT_PATH"
echo "时间: ${DATE_TIME:-unknown}"
echo "系统: ${OS_VERSION:-unknown}"
echo "进程: ${APP_NAME:-unknown}"
echo "异常: ${EXCEPTION_TYPE:-unknown}"
echo "终止原因: ${TERMINATION_REASON:-unknown}"
echo "崩溃线程: ${TRIGGERED_THREAD:-unknown}"
echo ""

echo "== Last Exception Backtrace =="
awk '
  /^Last Exception Backtrace:/ { in_block=1; next }
  in_block && /^$/ { exit }
  in_block { print }
' "$REPORT_PATH"
echo ""

if [ -n "$TRIGGERED_THREAD" ]; then
  echo "== Thread ${TRIGGERED_THREAD} Crashed =="
  awk -v tid="$TRIGGERED_THREAD" '
    $0 ~ ("^Thread " tid " Crashed:") { in_block=1; print; next }
    in_block && /^Thread [0-9]+/ { exit }
    in_block { print }
  ' "$REPORT_PATH"
  echo ""
fi

echo "== OneBoxM Source Frames (All Threads) =="
awk '
  /^Thread [0-9]+/ {
    thread=$2
    gsub(":", "", thread)
  }
  /OneBoxM/ && /\([A-Za-z0-9_\/.-]+\.[A-Za-z]+:[0-9]+\)/ {
    printf "Thread %s | %s\n", thread, $0
  }
' "$REPORT_PATH"
