#!/bin/sh
# 路由模板资产的构建期兜底。
#
# 模板是 gitignored 的构建期资产（`make templates` 从 .env 的两个 URL 拉取），干净检出与新建
# worktree 里都不存在。缺了它编译**照样通过**——`Bundle.main.url(forResource:)` 要到用户点连接、
# `AppActions.templateText` 才 `preconditionFailure`，而崩溃报告要从设备拉回来才看得懂。
#
# 故与外链 xcconfig 同一姿态（缺文件即构建失败），把这条错误提前到编译期。
set -eu

: "${SRCROOT:?SRCROOT is required}"

templates_dir="${SRCROOT}/App/Templates"
status=0

for name in tun-rules.json tun-global.json; do
    path="${templates_dir}/${name}"
    if [ ! -s "$path" ]; then
        echo "error: 缺路由模板资产 ${path} —— 跑 \`make templates\`"
        status=1
    fi
done

exit "$status"
