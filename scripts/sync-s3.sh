#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────
# sync-s3.sh — 将 target/s3/ 下所有 APK 同步到 S3
#
# 环境变量（必须）:
#   S3_BUCKET  — 目标 S3 路径，如 s3://my-bucket/apks
#
# 环境变量（可选）:
#   AWS_PROFILE — AWS CLI profile，默认使用 default
#   AWS_REGION  — 区域，默认不指定（使用 CLI 配置）
#
# 用法:
#   S3_BUCKET=s3://my-bucket/apks ./scripts/sync-s3.sh
#   make sync-s3  （从 .env 读取 S3_BUCKET）
# ────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_DIR="$PROJECT_DIR/target/s3"

# ── 前置检查 ────────────────────────────────────────────────
if [ -z "${S3_BUCKET:-}" ]; then
  echo "❌ S3_BUCKET 未设置。请在 .env 中配置或通过环境变量传入"
  echo "   示例: S3_BUCKET=s3://my-bucket/apks make sync-s3"
  exit 1
fi

if ! command -v aws &>/dev/null; then
  echo "❌ 未找到 aws CLI，请先安装: brew install awscli"
  exit 1
fi

if [ ! -d "$SOURCE_DIR" ]; then
  echo "❌ 目录不存在: $SOURCE_DIR"
  exit 1
fi

# 统计本地 APK 文件（0 也继续执行，以便删除远端孤立对象）
APK_COUNT=$(find "$SOURCE_DIR" -maxdepth 1 -name '*.apk' | wc -l | tr -d ' ')

# ── 构建 aws 公共参数 ───────────────────────────────────────
AWS_OPTS=()
if [ -n "${AWS_REGION:-}" ]; then
  AWS_OPTS+=(--region "$AWS_REGION")
fi

# ── 解析 S3 bucket 和 prefix ────────────────────────────────
# 去掉末尾斜杠，避免拼接时出现双斜杠
S3_BUCKET="${S3_BUCKET%/}"
s3_no_prefix="${S3_BUCKET#s3://}"
BUCKET="${s3_no_prefix%%/*}"
PREFIX="${s3_no_prefix#*/}"
if [ "$PREFIX" = "$BUCKET" ]; then
  PREFIX=""
fi

# ── 逐文件对比 MD5 后同步 ───────────────────────────────────
echo "▶ 同步 APK 到 S3..."
echo "  源目录: $SOURCE_DIR"
echo "  目标:   $S3_BUCKET"
echo "  文件数: $APK_COUNT"
echo ""

UPLOADED=0
SKIPPED=0
DELETED=0

shopt -s nullglob
for apk in "$SOURCE_DIR"/*.apk; do
  filename="$(basename "$apk")"
  object_key="${PREFIX:+$PREFIX/}$filename"

  # 本地 MD5
  local_md5="$(md5 -q "$apk")"

  # 读取远程自定义 metadata 中保存的 MD5（分段上传时 ETag ≠ MD5，不可靠）
  remote_md5="$(aws s3api head-object \
    --bucket "$BUCKET" \
    --key "$object_key" \
    ${AWS_OPTS[@]+"${AWS_OPTS[@]}"} \
    --output text --query 'Metadata."content-md5"' 2>/dev/null || echo "")"

  if [ "$local_md5" = "$remote_md5" ]; then
    echo "  ⏭  $filename — hash 一致，跳过 (md5: $local_md5)"
    SKIPPED=$((SKIPPED + 1))
  else
    echo "  ⬆  $filename — 上传中... (local: $local_md5, remote: ${remote_md5:-none})"
    aws s3 cp "$apk" "$S3_BUCKET/$filename" \
      --acl public-read \
      --metadata "content-md5=$local_md5" \
      ${AWS_OPTS[@]+"${AWS_OPTS[@]}"}
    echo "  ✔  $filename — 上传完成 (md5: $local_md5)"
    UPLOADED=$((UPLOADED + 1))
  fi
done

# ── 删除远端孤立对象（本地已不存在的 .apk） ────────────────
echo ""
echo "▶ 检查远端孤立 APK..."
remote_keys="$(aws s3api list-objects-v2 \
  --bucket "$BUCKET" \
  ${PREFIX:+--prefix "$PREFIX/"} \
  ${AWS_OPTS[@]+"${AWS_OPTS[@]}"} \
  --output text --query 'Contents[].Key' 2>/dev/null || echo "")"

if [ -n "$remote_keys" ] && [ "$remote_keys" != "None" ]; then
  for key in $remote_keys; do
    # 仅处理 .apk
    case "$key" in
      *.apk) ;;
      *) continue ;;
    esac
    remote_filename="${key##*/}"
    # 仅处理当前 prefix 下的直接子对象，避免误删子目录
    expected_key="${PREFIX:+$PREFIX/}$remote_filename"
    if [ "$key" != "$expected_key" ]; then
      continue
    fi
    if [ ! -f "$SOURCE_DIR/$remote_filename" ]; then
      echo "  🗑  $remote_filename — 本地已删除，移除远端对象"
      aws s3api delete-object \
        --bucket "$BUCKET" \
        --key "$key" \
        ${AWS_OPTS[@]+"${AWS_OPTS[@]}"} >/dev/null
      DELETED=$((DELETED + 1))
    fi
  done
fi

echo ""
echo "✅ 同步完成 — 上传 $UPLOADED 个，跳过 $SKIPPED 个（hash 一致），删除 $DELETED 个"
