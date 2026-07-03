---
applies-to: src/utils/domain-verification.ts, src/utils/domain-suffix.ts, src/modules/expo-onebox/android/**/BackgroundConfigWorker.kt, src/modules/expo-onebox/ios/core/BackgroundConfigRefresh.swift
loaded-when: 审查者在任何面向 Claude 的文件中标记出明文域名；调查者触及 apply=1 / 加速器回落 / BG 刷新；实现者新增自动应用路径
updated-on: new-convention
---

# domain-allowlist

## 规则
`DEFAULT_KNOWN_DOMAIN_SHA256_LIST`（TS，`src/utils/domain-verification.ts`）+ Kotlin + Swift 镜像保存受信域名/后缀的 sha256 摘要。**预映像（明文主机名）绝不能出现**在任何源文件、注释、测试夹具、提交、PR 描述、日志行、i18n 字符串或 `CHANGELOG.md` 中——无论是在本仓库还是隔壁的 OneBox Tauri 仓库。

## 为什么
category: bug (security).
failure: 预映像泄露会把 hash 校验降级成一次公开可查的字符串比较。allowlist 加上来自 `sing-box.net` 的远程列表，是拥有 OneBoxRN 构建的攻击者与"受信到足以自动应用的域名集合"（`apply=1` 深链接、加速器回落）之间唯一的关卡。
constraint: 十六进制摘要就是全部的公开表面。审查者会把任何明文线索——变量名、测试夹具、注释、提交正文、CHANGELOG 行——都标为 blocker。

## 如何添加新的受信域名/后缀
1. 离线计算 sha256（绝不在会话中输出，绝不在聊天或提交正文里写"X 的 sha256 是 Y"这类配方）
2. 把十六进制摘要加入 `DEFAULT_KNOWN_DOMAIN_SHA256_LIST` + 两个原生镜像（Kotlin、Swift）
3. 提交信息描述为 "expanded supported servers"——不含主机名
4. 若约定发生变化，用原因类别更新本文档的 `updated-on`

## 后缀匹配
当某个父后缀的 hash 在列表中时，`hostnameMatchesAllowlist` / `hostnameMatchesAnyAllowlist` 会放行整棵子树。顺序：最短后缀优先。契约：`src/utils/domain-suffix.test.ts`。

## 提交前钩子
如果你发现自己正在注释或日志里敲 `// sha256("example.com")`——保存前删掉。hash 会自我说明其功能；它放行的是哪棵子树，是刻意保持不透明的。
