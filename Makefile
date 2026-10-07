# OneBoxM 聚合构建入口。
# 约定：target 用 kebab-case <域>-<细分>；聚合词无前缀。绝不臆造命令。

.DEFAULT_GOAL := help

ENV_BUILD_MODE := $(shell sed -n 's/^build_mode=//p' .env 2>/dev/null | head -n1)
BUILD_MODE := $(if $(ENV_BUILD_MODE),$(ENV_BUILD_MODE),debug)

# ─────────────────────────────────────────────────────────────
# 门禁：单一入口 `make check [rule=<名>]`，缺省跑全部。
# 规则清单不在这里抄：单一来源是下面的 CHECK_RULES（`make check rule=list` 打印它），
# 由 check rule=rule-consistency 与调度列表比对。

# 门禁脚本互相 import，Python 默认会在 scripts/ 下写 __pycache__/*.pyc，而 rule=size 对未知
# 扩展名 fail-closed ⇒ 跑一次 `make check` 就把自己弄红。在这里统一禁掉字节码写入。
export PYTHONDONTWRITEBYTECODE := 1
# 各条的禁用模式与豁免清单就在本节，分别是各自的单一来源。
#
# naming 命名禁令：禁止上游内核相关词汇进入本仓自主命名。豁免清单就是下面的 NAMING_EXEMPT，
#   此处不重抄。能进那张表的只有三类：上游构建管线（engine/）；只允许出现上游 ABI 符号的引擎
#   绑定与唯一链接锚；承载对外协议契约 UA 字面量的文件（构造点，以及钉住它的测试）。
#   本 Makefile 自身在表内，因为禁用模式的定义就写在这里。
# terms  App Store 术语规则：禁用暗示订阅/周期付费的措辞，一律用 config / profile 系词。
#   Swift 的 `subscript(` 含同一子串且无法回避，但不整文件豁免（那会留下永久盲区），而是把命中行
#   里的 `subscript(` token 剔除后重判——丢弃整行会放过同一行里的禁用措辞。
#   豁免：两端 core Userinfo（对外协议头字段字面量）、vpn/TunnelController.kt 与
#   ui/LogsViewModel.kt（kotlinx.coroutines 平台 API 引用）、本 Makefile 自身。
# i18n   Android / Apple 键名逐字同名：翻译齐全、键集合对称、无死键。豁免 = 平台专有键（下方各组）。
#   自定义 tr() 让 Xcode 提取器失效，本门禁补上它本该给的检查：Android 缺声明是编译错误，
#   iOS 缺声明却只在运行时静默回落成键名本身，故两向都查。
#   引用集合取两种口径，两向都保守：判「死键」用宽口径（Swift 全部字面量，避免经 viewKey() 之类
#   辅助函数间接引用的键被误杀）；判「引用未声明」用严口径（只认 tr("字面量")）。
# ─────────────────────────────────────────────────────────────
NAMING_EXEMPT := -e '^engine/' \
  -e '^android/app/src/main/kotlin/cloud/oneoh/oneboxn/bridge/EngineBinding\.kt$$' \
  -e '^android/app/src/main/kotlin/cloud/oneoh/oneboxn/net/UserAgent\.kt$$' \
  -e '^ios/Tunnel/EngineBinding\.swift$$' \
  -e '^ios/App/VPN/MonitorBinding\.swift$$' \
  -e '^ios/EngineKit/Sources/EngineKit/EngineKit\.m$$' \
  -e '^ios/App/Net/UserAgent\.swift$$' \
  -e '^ios/AppTests/UserAgentTests\.swift$$' \
  -e '^Makefile$$' \
  -e '^CLAUDE\.md$$'

# 两组匹配：
#  - SUBSTR：区分度高的 token 用子串匹配，捕获 camelCase 粘连符号（如 LibboxSetup）。
#  - WORDS ：三字母歧义 token 用词边界匹配，避免误伤 asftp 等普通词。
# 两组都同时扫描「文件内容」与「文件/目录路径名」（禁令覆盖标识符与文件名）。
NAMING_SUBSTR := libbox|singbox|nekohasekai|sagernet|sing[-_ ]?box
NAMING_WORDS := sfa|sfi|sfm|sft

TERMS_EXEMPT := -e '^android/core/src/main/kotlin/cloud/oneoh/oneboxn/core/Userinfo\.kt$$' \
  -e '^ios/Core/Sources/Core/Userinfo\.swift$$' \
  -e '^android/app/src/main/kotlin/cloud/oneoh/oneboxn/vpn/TunnelController\.kt$$' \
  -e '^android/app/src/main/kotlin/cloud/oneoh/oneboxn/ui/LogsViewModel\.kt$$' \
  -e '^Makefile$$'

TERMS_SUBSTR := subscri

# i18n 键目录（三份文件即全部键的来源）。
I18N_ANDROID_EN := android/app/src/main/res/values/strings.xml
I18N_ANDROID_ZH := android/app/src/main/res/values-zh/strings.xml
I18N_IOS := ios/App/Localizable.xcstrings
# Info.plist 用途描述等 OS 直接展示的串（相机用途等）：不进 Localizable，另建 catalog，
# 但同样必须两语齐全——缺中文时 OS 会把英文原样弹给中文用户，且没有任何代码引用能暴露它。
I18N_IOS_INFOPLIST := ios/App/InfoPlist.xcstrings
# 产品名不翻译（en 单语即完整）。
I18N_INFOPLIST_EN_ONLY := CFBundleDisplayName|CFBundleName

# 平台专有键：只在单端存在是设计而非遗漏。
#  Apple 专有（I18N_IOS_ONLY）：
#    settings_on_demand_*：NEOnDemand，Android 无对应能力；
#    settings_include_*：网络包含范围开关，Android 的 VpnService 本就全量接管，无 APNs 排除面；
#    settings_advanced_apply_hint：Apple 高级页的网络包含范围开关在隧道下次启动时才生效，页脚要说明；
#      Android 高级页只剩后台运行豁免入口，即时生效，没有要提示的东西；
#    control_*：控制中心控件文案，与 tile_* 互为对应物但形态不同（磁贴标题+副标题两行、控件标题+值），
#      硬凑同名会让其中一端多出死键；
#    logs_more：Apple 日志页把来源/级别/清空合并进导航栏一个 `⋯` 菜单，这是那枚按钮的无障碍标签；
#      Android 的 TopAppBar 宽度够、逐项平铺，不需要这个键；
#    update_action_view / update_action_install / update_action_retry：
#      Apple 侧仍留着直装更新那一组消费方（`UpdateRowAction` 的 view/install/retry 三臂），
#      Android 是商店版不得自我更新；那组消费方删掉时这几条同笔删除。
#  Android 专有：应用名（iOS 由 InfoPlist.xcstrings 承载）、系统 VPN 授权与后台运行豁免对话框
#    （NE 由系统承担文案）、前台服务通知及其权限引导（notification_* 与 home_notification_permission_*：
#    NE 无前台服务通知）、快捷设置磁贴（tile_*：iOS 的对应物是控制中心控件，文案键另起）、
#    profiles_active（配置列表里「当前使用」的无障碍状态词：Apple 走原生 isSelected 特征，标签里不带
#    状态词）。
#
# 「单端使用」不是专有：键在两端声明、只有一端引用确实存在。它不靠「取并集」默许——并集会让
# 「某一端根本没接消费者」与「这一端本来就不需要」读数相同。逐端判，合理的那些逐个具名声明在
# I18N_ANDROID_NO_CONSUMER / I18N_APPLE_NO_CONSUMER，每行写清这一端为什么不需要。
# `check i18n` 带反查：键已被本端消费、或已不在本端 catalog，这一行即报「已失效」。
#
I18N_ANDROID_NO_CONSUMER :=

I18N_APPLE_NO_CONSUMER :=

I18N_ANDROID_ONLY := app_name|home_background_permission_.*|home_notification_permission_.*|home_vpn_permission_.*|notification_.*|profiles_active|settings_background_run_.*|tile_.*
I18N_IOS_ONLY := settings_on_demand_.*|settings_include_.*|settings_advanced_apply_hint|control_.*|logs_more|update_action_view|update_action_install|update_action_retry

# 中立契约在某一端有理由多出必需成员时，逐条写下理由；缺理由即 FAIL，声明过期同样报红。
#
# 声明跳过的不止成员集合，还有参数个数（arity）：判据里 `if name in declarations: continue` 排在
# arity 检查之前。补偿是下面这份逐字快照，由 `check rule=neutral-contract-parity` 逐条核，改契约
# 不改这里即报红。`>>> / <<<` 两行是判据认的边界：标记不在时报「找不到快照」，不静默跳过。
#
# >>> arity-snapshot
# ConfigFetcher
#   android : fetch/2
#   apple   : fetch/2
# Engine
#   android : start/1, reload/1, stop/0, pause/0, wake/0
#   apple   : start/1, reload/1, stop/0, pause/0, wake/0
# Monitor
#   android : setHandler/1, currentStatus/0, lastError/0, selectNode/1, urlTest/1, detachHandler/0, close/0
#   apple   : setHandler/1, currentStatus/0, lastError/0, selectNode/1, urlTest/1, detachHandler/0, close/0
# MonitorHandler
#   android : onStatus/1, onTraffic/1, onGroups/1, onLog/1, onError/1
#   apple   : onStatus/1, onTraffic/1, onGroups/1, onLog/1, onError/1
# ProfileStorage
#   android : load/0, save/1
#   apple   : load/0, save/1
# RefreshRecordStorage
#   android : load/0, save/1
#   apple   : load/0, save/1
# RuleStorage
#   android : load/0, save/1
#   apple   : load/0, save/1
# TunHost
#   android : openTun/1, protect/1, writeLog/1
#   apple   : openTun/1, protect/1, writeLog/1
# TunnelControl
#   android : stop/0, start/0
#   apple   : stop/0, start/0
# <<< arity-snapshot
NEUTRAL_CONTRACT_DIVERGENCES :=

# golden 默认两端消费；只有一端消费必须在这张中央表声明，夹具内不得自带 platforms 字段。
# 全表条数由 `make check rule=golden` 现打，这里不写：写下的计数会漂。
GOLDEN_PLATFORM_DECLARATIONS := \
  groups-snapshot=apple:android-pulls-groups-over-a-binder-messenger-from-the-tun-process-so-there-is-no-file-snapshot-codec \
  observation-command=apple:android-control-channel-is-a-binder-messenger-carrying-typed-bundles-so-the-byte-level-command-framing-has-no-android-mirror \
  observation-frame=apple:android-observation-channel-is-a-binder-messenger-carrying-typed-bundles-so-the-fixed-width-datagram-framing-has-no-android-mirror \
  observation-peer-belief=apple:android-observation-channel-is-a-bound-binder-service-not-a-datagram-socket-so-there-is-no-congested-send-failure-to-classify \
  observation-pending-log-buffer=apple:android-drops-a-client-whose-binder-send-fails-so-there-is-no-failed-batch-to-prepend-back \
  reload-outcome-record=apple:android-delivers-the-reload-outcome-as-a-typed-intent-broadcast-so-the-byte-level-outcome-record-has-no-android-mirror \
  stale-session-gate=apple:the-cross-process-generation-mismatch-does-not-exist-in-the-android-foreground-service-model \
  start-diagnosis=apple:androids-tunnel-is-an-in-app-tun-service-so-the-system-keeps-a-timestamped-exit-list-and-start-diagnosis-level-2-is-fully-covered-by-level-3-there-so-it-is-not-a-skipped-level \
  tunnel-start-options=apple:android-hands-off-via-tunnel-config-handoff-not-a-start-options-file \
  utf8-length=android:platforms-with-byte-budget-callers-only \
  update-decision=apple:android-takes-the-update-verdict-straight-from-play-with-the-target-build-so-there-is-no-local-version-comparison

# 历史夹具名与类型名不完全一一 kebab-case 的显式映射；新夹具不得再扩展这里。
# Android 与 Apple 必须逐字同名实现的 core 类型。
GOLDEN_NAME_PARITY_CORE_TYPES := AcceleratedConfigFetcher ConfigChange ConfigCheck ConfigFetcher ConfigFingerprint ConfigMerge ConfigRefresh CurveSmoothing DnsProbe DnsProbeGate DomainVerify DurationFormat Engine EngineInfo FetchPolicy ImportConclusion ImportFlow ImportLink Json LogKeywordFilter MemoryTrend Monitor NodeLatency NodeSelection ObservationFreshness ObservationHealth ProfileDestination ProfileExpiry ProfileName ProfileStorage ProfileStore ProfileWebsite RefreshRecordStorage RefreshRecordStore Region RuleStorage RuleStore RuleToken TextEscape TrafficFormat TrafficRateEstimator TrafficRateTrend TunnelControl TunnelTeardown UpdateCheckSchedule UrlInfo UsageAccumulator UsageChartHit UsageHistory Userinfo

GOLDEN_TYPE_FIXTURE_ALIASES := LogKeywordFilter=log-keyword

# 一份夹具可声明裁判多个 core 类型；反查二只认这张中央覆盖表，不靠“文件名必须等于类型名”的隐式约定。
GOLDEN_FIXTURE_TYPES := config-refresh=ConfigRefresh,FetchReply diagnosis-detail=DiagnosisDetail failure-source=FailureSource groups-snapshot=GroupsSnapshotCodec import-flow=ImportError,ImportFlow,ImportPhase json=Json,JsonValue legacy-import=LegacyImport,LegacyImportPlan log-keyword=LogKeywordFilter log-level=LogLevel observation-command=ObservationCommand,ObservationCommandCodec,ObservationSnapshotCodec observation-frame=ObservationDatagramDecoder,ObservationFrame,ObservationFrameCodec profile-destination=ProfileDestination,ProfileMark reload-outcome-record=ReloadOutcomeCodec,ReloadOutcomeRecord,ReloadOutcomeRecordCodec routing-mode=RoutingMode start-diagnosis=DiagnosticRead,StartDiagnosis tunnel-start-options=TunnelStartOptionsSnapshot usage-history=UsageHistory,UsagePending,UsageTier

# 反查二只覆盖「跨端镜像的 core 纯逻辑」。下列同名 core 文件不是 golden 裁判对象：
# 端口/存储协议、平台桥接 DTO、无可观察算法的枚举占位、或已有端内特征测试锁住的低层 helper。
# 不能把应建夹具的类型加进这里回避门禁。
GOLDEN_NON_GOLDEN_CORE_TYPES := AcceleratedConfigFetcher:async-orchestrator-over-an-injected-fetcher-not-a-pure-value-mapping ConfigFetcher:port-interface-no-pure-value-output Engine:port-interface-no-pure-value-output EngineInfo:platform-bridge-dto-risk-lives-in-the-bridge-not-an-algorithm EngineLogPolicy:same-name-different-input-domain-android-core-only-carries-the-store-threshold Monitor:port-interface-no-pure-value-output ObservationHealth:platform-bridge-capability-shell-not-a-value-projection Profile:cross-platform-dto-the-behavior-lives-in-profile-store-not-in-this-shape ProfileStorage:port-interface-no-pure-value-output RefreshRecordStorage:port-interface-no-pure-value-output RuleStorage:port-interface-no-pure-value-output TunnelControl:port-interface-no-pure-value-output

# 按源码扫描的门都经 `scripts/source_files.py` 取本机全量源码（入库 ∪ 未跟踪 ∪ .gitignore 私有段）：
# 新文件 git add 之前正是最常跑门禁的窗口，而私有资产永远不进索引——只看索引的门对两者都是瞎的。
# 模式化日期/时间格式化器的唯一构造点（check rule=locale 的唯一豁免）：
# DateFormatter 不钉 locale 就跟随环境日历——同一纪元秒在伊朗（本产品支持地区）会格式化成
# 波斯历年份，与 Android 的 Locale.US 全不对齐。
# 唯一构造点只豁免「不许出现 dateFormat」这一条，不豁免「自身必须钉 POSIX」——
# 否则删掉它内部那行 locale 赋值，门禁照样全绿，而它正是本门禁要防的那个回归。
# 本门只管「模式化日期 / 时间」这一类区域敏感 API：`strerror(errno)` 的返回也与 locale 相关，但它
# 只进日志、不跨 ABI、不进 UI、不参与判等；一旦被呈现给用户或拿去比较 / 解析，本门要扩到那一处。
LOCALE_SWIFT_EXEMPT := ios/App/UI/FixedDateFormat.swift
LOCALE_FIXED_IDENTIFIER := en_US_POSIX
# locale 判据按文本匹配，偏严一侧有意保留：假红的代价只是改个措辞。它也拦纯粹的时间计算（取当前
# 时刻做 deadline），撞上就换单调计时原语，别为了让调用点过去放宽这道门。
# 已确认的分类塌陷（`check rule=classification-collapse`）。格式 `路径:键=理由`，
# 理由里用 `_` 代空格（make 变量按空格分词）。每条自带判据：那一处不再塌陷时本条即失效并报红，
# 于是它不会像一张纯豁免名单那样替将来同名的塌陷遮着。
# 与 I18N_* 那几张表不同：那些登记平台差异（这一端本就不该有），本表登记已知、待修的缺口；
# 往本表里写「平台差异」或往那几张表里写「还没做」，都是判据查不出来的假话。
# 空表下扫描面照样是两端全部生产源码，新出现的全塌陷会直接报红。
CLASSIFICATION_COLLAPSE_KNOWN :=

API_SHAPE_BASELINE := scripts/api-shape-baseline.json
TEST_COUNT_BASELINE := scripts/test-count-baseline.json

# 「随交互态变化的填充没带形状参数」——两张表，说的是相反的话，所以不能合并。
# 判准是这层底露不露出它下面的卡：露出来 ⇒ 四角在卡内 ⇒ 必须给形状；与卡沿重合 ⇒ 给它加圆角是在
# 卡沿上啃豁口，不是修缺陷。这一句静态判不出来，所以要有豁免表。
# 豁免 = 量过、确认不露出（永久，理由里必须带读数）；棘轮 = 还没判 / 还没修（临时，必须被还掉）。
# 混在一起就分不清剩下的是有意的差异还是待修的缺口，而两者的处置完全相反。
# 豁免按符号登记不按行号：行号随上下任何改动漂，漂掉的豁免要么静默失效（假红）、要么静默盖住别处
# （假绿）。判据核「豁免还对得上某处命中」，对不上即红要求删掉它。
LINES_CORNERS_STATE_FILL_EXEMPT := \
  SettingsRowStyle:row-is-339-wide-equal-to-the-card-so-the-fill-corners-coincide-with-the-card-edge-measured-hovering-72-corners-0-hits

LINES_CORNERS_STATE_FILL := 0

# ── 扫描面含自身的门要声明怎么排除 ─────────────────────────────────────
#
# 下面是还没写声明的门，只减不增：新门不许进名单（新写的直接合规），名单里的写了声明就同一笔删掉。
# 理由必须作者自己填——「结构上免疫」与「未处置而恰好零命中」在别人眼里长得一模一样。
# 「扫描面不排除：<理由>」同样是合格声明：模式的危害不依赖它出现在代码位置上时，剥注释会把真红剥掉。
# 判别式见 scripts/check-self-scan-declaration.py 的「不排除是合法答案」一节。
# 粒度是硬词表：文件 / 小节 / 行 / 词法，四选一；自由的只有冒号后面那半（怎么排除）。
# 「词法」指剥注释剥成等长空白以保住行号（按行删除不保证）。
# 没有棘轮的名单就是一张豁免表：谁都可以把「还没做」写进去而没人知道它在涨。
SELF_SCAN_UNDECLARED_RATCHET := 9
SELF_SCAN_UNDECLARED := \
  exemption-paths failure-paths gate-self-declaration gate-test-pairing \
  negative-case-distinctness negative-gates negative-probe-anchors rule-consistency test-legs

# ── 透明度字面量：还没给出理由的那些 ──────────────────────────────────
#
# 一切透明度字面量都进被判面，未处置的具名列在这里，只减不增（按关键词窗口认「禁用语境」会被
# 同义词绕过，而词表没有分母）。两条出路，处置掉就同笔从名单删掉并把棘轮降 1：
#   ① 改用令牌；
#   ② 在那一行（或上一行）写 `透明度字面量：<为什么这里就该是字面量>`。
# 理由作者自己填——只有写那一行的人知道它是哪个角色。
# 名单按文件认（行号会漂）；代价是同一份文件长出第二处会被静默吸收 ⇒ 判据兜底：名单里的文件出现
# >1 处字面量即报红。名单收的是那一处，不是那份文件从此免检。
DISABLED_OPACITY_UNDECLARED := \
  ios/App/UI/ImportScreen.swift
DISABLED_OPACITY_RATCHET := 1


# 仓内唯一允许存在的文档。
DOC_ALLOWLIST := LICENSE.md

# ─────────────────────────────────────────────────────────────
# 规则清单的唯一来源：check 目标的用法串（`make check rule=list`）与 `make help` 都引用这个变量，
# 谁也抄不了。rule-consistency 的用法串抽取器会解析它（scripts/check-rule-consistency.py 的
# extract_check_usage_rules），再与 check 的 all 分支、各 case 分支、check-test-gates、
# check-negative-gates 的 cases 逐条比对——单一来源不等于免检。
# 顺序与 check 的 all 分支一致，便于肉眼对读；判据比的是集合，顺序不参与。
# ─────────────────────────────────────────────────────────────
CHECK_RULES := naming terms i18n api-shape golden locale size ios-hidden-opacity gate-self-declaration theme-palette apple-font-source \
  apple-color-source apple-radius-source apple-handler-defaults android-font-source android-color-source android-radius-source i18n-placeholder-order \
  gate-test-pairing failure-path neutral-contract-parity rule-consistency test-legs classification-collapse lines-and-corners disabled-opacity \
  negative-case-distinctness negative-probe-anchors self-scan-declaration apple-handoff-atomic connection-truth-source module-name-binding \
  commit-script script-tests run-ios-launch-flag cold-compile doc-allowlist

# `|` 连接：make 没有 join 函数，靠 subst 把空格换成竖线（EMPTY/SPACE 是标准写法）。
EMPTY :=
SPACE := $(EMPTY) $(EMPTY)
CHECK_RULES_PIPE := $(subst $(SPACE),|,$(strip $(CHECK_RULES)))

.PHONY: check check-test-gates check-negative-gates find-duplicate-gate
check:
	@case "$(rule)" in \
	      ""|all) \
	    failed=""; \
	    for rule in $(CHECK_RULES); do \
	      $(MAKE) --no-print-directory check rule=$$rule || failed="$$failed $$rule"; \
	    done; \
	    if [ -n "$$failed" ]; then \
	      echo "check FAILED —— 以下规则未通过：$${failed}"; \
	      echo "  （all 分支**逐条跑完再汇总**，不在第一处失败就停：短路会让一条常驻红债"; \
	      echo "    把排在它后面的门全部静默关掉。）"; \
	      exit 1; \
	    fi; \
	    echo "check OK（$(words $(CHECK_RULES)) 条规则全部通过）" ;; \
	  naming) \
	    python3 scripts/check-exemption-paths.py naming || exit 1; \
	    files=$$(python3 scripts/source_files.py) || { echo "check naming FAILED —— 源码枚举失败，门禁根本没扫"; exit 1; }; \
	    files=$$(printf '%s\n' "$$files" | grep -vE $(NAMING_EXEMPT)); \
	    [ -n "$$files" ] || { echo "check naming FAILED —— 待扫文件集为空，门禁根本没扫（报 OK 比不扫更糟，故此处退出）"; exit 1; }; \
	    path_hits=$$( { printf '%s\n' "$$files" | grep -iE '$(NAMING_SUBSTR)'; \
	                   printf '%s\n' "$$files" | grep -iwE '$(NAMING_WORDS)'; } \
	                 | sed 's/^/PATH: /'); \
	    body_hits=$$( { printf '%s\n' "$$files" | xargs -I{} grep -HnIiE '$(NAMING_SUBSTR)' {} 2>/dev/null; \
	                   printf '%s\n' "$$files" | xargs -I{} grep -HnIiwE '$(NAMING_WORDS)' {} 2>/dev/null; } ); \
	    hits=$$(printf '%s\n%s\n' "$$path_hits" "$$body_hits" | grep -v '^$$' | sort -u); \
	    if [ -n "$$hits" ]; then \
	      echo "check naming FAILED —— 发现上游内核禁用词（应改中立命名 engine，或移入豁免的绑定文件）："; \
	      printf '%s\n' "$$hits" | sed 's/^/  /'; \
	      exit 1; \
	    fi; \
	    echo "check naming OK" ;; \
	  terms) \
	    python3 scripts/check-exemption-paths.py terms || exit 1; \
	    files=$$(python3 scripts/source_files.py) || { echo "check terms FAILED —— 源码枚举失败，门禁根本没扫"; exit 1; }; \
	    files=$$(printf '%s\n' "$$files" | grep -vE $(TERMS_EXEMPT)); \
	    [ -n "$$files" ] || { echo "check terms FAILED —— 待扫文件集为空，门禁根本没扫（报 OK 比不扫更糟，故此处退出）"; exit 1; }; \
	    hits=$$( { printf '%s\n' "$$files" | grep -iE '$(TERMS_SUBSTR)'; \
	              printf '%s\n' "$$files" | xargs -I{} grep -HnIiE '$(TERMS_SUBSTR)' {} 2>/dev/null; } \
	            | awk '{ line = $$0; gsub(/subscript\(/, "", line); if (tolower(line) ~ /subscri/) print $$0 }' \
	            | grep -v '^$$' | sort -u); \
	    if [ -n "$$hits" ]; then \
	      echo "check terms FAILED —— 发现订阅系措辞（App Store 术语规则：改用 config / profile 系词）："; \
	      printf '%s\n' "$$hits" | sed 's/^/  /'; \
	      exit 1; \
	    fi; \
	    echo "check terms OK" ;; \
	  api-shape) \
	    command -v python3 >/dev/null 2>&1 \
	      || { echo "check api-shape FAILED —— 无 python3，API 形状棘轮根本没跑（报 OK 比不跑更糟）"; exit 1; }; \
	    python3 scripts/measure-api-shape.py --check-baseline $(API_SHAPE_BASELINE) ;; \
	  i18n) \
	    en=; zh=; ios=; aref=; iref=; ref=; \
	    trap 'rm -f "$$en" "$$zh" "$$ios" "$$aref" "$$iref" "$$ref"' EXIT; \
	    en=$$(mktemp) && zh=$$(mktemp) && ios=$$(mktemp) && aref=$$(mktemp) && iref=$$(mktemp) && ref=$$(mktemp) \
	      || { echo "check i18n FAILED —— mktemp 不可用，门禁根本没跑（报 OK 比不跑更糟，故此处退出）"; exit 1; }; \
	    sed -n 's/^[[:space:]]*<string name="\([^"]*\)".*/\1/p' $(I18N_ANDROID_EN) | sort -u > "$$en"; \
	    sed -n 's/^[[:space:]]*<string name="\([^"]*\)".*/\1/p' $(I18N_ANDROID_ZH) | sort -u > "$$zh"; \
	    sed -n 's/^    "\(.*\)" : {.*/\1/p' $(I18N_IOS) | sort -u > "$$ios"; \
	    for extracted in "$$en" "$$zh" "$$ios"; do \
	      [ -s "$$extracted" ] || { echo "check i18n FAILED —— 键集抽取为空：源 catalog 缺失或格式已变，抽取器需同步"; exit 1; }; \
	    done; \
	    android_only='$(I18N_ANDROID_ONLY)'; ios_only='$(I18N_IOS_ONLY)'; \
	    android_no_consumer=$$(printf '%s\n' $(I18N_ANDROID_NO_CONSUMER) | paste -sd'|' -); \
	    apple_no_consumer=$$(printf '%s\n' $(I18N_APPLE_NO_CONSUMER) | paste -sd'|' -); \
	    [ -n "$$android_no_consumer" ] || android_no_consumer='a^'; \
	    [ -n "$$apple_no_consumer" ] || apple_no_consumer='a^'; \
	    for name in android_only ios_only; do \
	      eval "value=\$$$$name"; \
	      [ -n "$$value" ] || eval "$$name='a^'"; \
	    done; \
	    for pattern in "$$android_only" "$$ios_only" '$(I18N_INFOPLIST_EN_ONLY)'; do \
	      printf 'x\n' | grep -qE "^($$pattern)$$"; \
	      [ $$? -le 1 ] \
	        || { echo "check i18n FAILED —— 单端豁免模式不是合法 ERE：$${pattern}（grep 以错误退出，那条比对会静默变成空操作）"; exit 1; }; \
	    done; \
	    python3 scripts/source_files.py 'android/*.kt' 'android/*.xml' | grep -v '/res/values' \
	      | xargs grep -hoE 'R\.string\.[a-zA-Z0-9_]+|@string/[a-zA-Z0-9_]+' /dev/null \
	      | sed 's/.*[./]//' | sort -u > "$$aref"; \
	    python3 scripts/source_files.py 'ios/*.swift' | xargs grep -hoE 'tr\("[a-zA-Z0-9_]+"' /dev/null \
	      | sed 's/tr("//;s/"//' | sort -u > "$$iref"; \
	    python3 scripts/source_files.py 'ios/*.swift' | xargs grep -hoE '"[a-zA-Z0-9_]+"' /dev/null \
	      | tr -d '"' | sort -u > "$$ref"; \
	    command -v python3 >/dev/null 2>&1 \
	      || { echo "check i18n FAILED —— 无 python3，InfoPlist catalog 检查根本没跑（报 OK 比不跑更糟）"; exit 1; }; \
	    plist_missing=$$(python3 -c 'import json,sys,re; \
d=json.load(open(sys.argv[1])); ex=re.compile("^(" + sys.argv[2] + ")$$"); \
print("\n".join(k for k,v in d.get("strings",{}).items() \
  if not ex.match(k) and sorted(v.get("localizations",{})) != ["en","zh-Hans"]))' \
	      $(I18N_IOS_INFOPLIST) '$(I18N_INFOPLIST_EN_ONLY)') \
	      || { echo "check i18n FAILED —— InfoPlist catalog 解析失败（格式已变？抽取器需同步）"; exit 1; }; \
	    hits=$$( { printf '%s' "$$plist_missing" | grep -v '^$$' | sed 's|^|InfoPlist 两语不齐: |'; \
	              comm -3 "$$en" "$$zh" | sed 's/^[[:space:]]*/翻译缺失: /'; \
	              comm -23 "$$en" "$$ios" | grep -vE "^($$android_only)$$" | sed 's/^/仅 Android 声明: /'; \
	              comm -13 "$$en" "$$ios" | grep -vE "^($$ios_only)$$" | sed 's/^/仅 iOS 声明: /'; \
	              comm -23 "$$aref" "$$en" | sed 's/^/Android 引用未声明: /'; \
	              comm -23 "$$iref" "$$ios" | sed 's/^/iOS 引用未声明: /'; \
	              comm -23 "$$en" "$$aref" | grep -vE "^($$android_no_consumer)$$" | sed 's/^/Android 侧零消费（本端声明了它，本端没有人用）: /'; \
	              comm -23 "$$ios" "$$ref" | grep -vE "^($$apple_no_consumer)$$" | sed 's/^/Apple 侧零消费（本端声明了它，本端没有人用）: /'; \
	              for key in $(I18N_ANDROID_NO_CONSUMER); do \
	                grep -qx "$$key" "$$en" || echo "声明已失效（键已不在 Android catalog）: I18N_ANDROID_NO_CONSUMER 的 $$key"; \
	                ! grep -qx "$$key" "$$aref" || echo "声明已失效（Android 已经有消费者了）: I18N_ANDROID_NO_CONSUMER 的 $$key"; \
	              done; \
	              for key in $(I18N_APPLE_NO_CONSUMER); do \
	                grep -qx "$$key" "$$ios" || echo "声明已失效（键已不在 Apple catalog）: I18N_APPLE_NO_CONSUMER 的 $$key"; \
	                ! grep -qx "$$key" "$$ref" || echo "声明已失效（Apple 已经有消费者了）: I18N_APPLE_NO_CONSUMER 的 $$key"; \
	              done; } ); \
	    if [ -n "$$hits" ]; then \
	      echo "check i18n FAILED —— 键集合不对称、引用缺声明，或**某一端**声明了键却没有消费者（逐端判，不取并集）："; \
	      printf '%s\n' "$$hits" | sed 's/^/  /'; \
	      exit 1; \
	    fi; \
	    echo "check i18n OK" ;; \
	  golden) \
	    command -v python3 >/dev/null 2>&1 \
	      || { echo "check golden FAILED —— 无 python3，golden 反查门禁根本没跑（报 OK 比不跑更糟）"; exit 1; }; \
	    python3 scripts/check-golden.py \
	      --platform-declarations '$(GOLDEN_PLATFORM_DECLARATIONS)' \
	      --aliases '$(GOLDEN_TYPE_FIXTURE_ALIASES)' \
	      --fixture-types '$(GOLDEN_FIXTURE_TYPES)' \
	      --name-parity-core-types '$(GOLDEN_NAME_PARITY_CORE_TYPES)' \
	      --non-golden-core-types '$(GOLDEN_NON_GOLDEN_CORE_TYPES)' ;; \
	  locale) \
	    swift_files=$$(python3 scripts/source_files.py 'ios/*.swift' | grep -vF '$(LOCALE_SWIFT_EXEMPT)'); \
	    kotlin_files=$$(python3 scripts/source_files.py 'android/*.kt'); \
	    { [ -n "$$swift_files" ] && [ -n "$$kotlin_files" ]; } \
	      || { echo "check locale FAILED —— 待扫文件集为空，门禁根本没扫（报 OK 比不扫更糟）"; exit 1; }; \
	    [ -f $(LOCALE_SWIFT_EXEMPT) ] \
	      || { echo "check locale FAILED —— 唯一构造点 $(LOCALE_SWIFT_EXEMPT) 不存在，豁免路径已漂移"; exit 1; }; \
	    pinned=$$(grep -cF 'locale = Locale(identifier: "$(LOCALE_FIXED_IDENTIFIER)")' $(LOCALE_SWIFT_EXEMPT)); \
	    built=$$(grep -cF 'DateFormatter()' $(LOCALE_SWIFT_EXEMPT)); \
	    if [ "$$pinned" != "1" ] || [ "$$built" != "1" ]; then \
	      echo "check locale FAILED —— 唯一构造点自身失守：$(LOCALE_SWIFT_EXEMPT) 须恰有一处"; \
	      echo "  DateFormatter() 构造（实测 $$built 处）且恰有一处 locale 钉 $(LOCALE_FIXED_IDENTIFIER)（实测 $$pinned 处）。"; \
	      exit 1; \
	    fi; \
	    hits=$$( { printf '%s\n' "$$swift_files" \
	                 | xargs grep -HnE 'dateFormat *=|DateFormatter\(\)|ISO8601DateFormatter|DateComponentsFormatter|RelativeDateTimeFormatter|\.formatted\(' 2>/dev/null \
	                 | sed 's/^/Apple 绕过唯一构造点: /'; \
	              printf '%s\n' "$$kotlin_files" \
	                 | xargs grep -HnE 'SimpleDateFormat\(|DateTimeFormatter\.ofPattern\(' 2>/dev/null \
	                 | grep -vF 'Locale.US' | sed 's/^/Android 未在同一行显式传 Locale.US: /'; } ); \
	    if [ -n "$$hits" ]; then \
	      echo "check locale FAILED —— 模式化日期/时间未钉死日历与数字字形："; \
	      printf '%s\n' "$$hits" | sed 's/^/  /'; \
	      echo "  Apple 一律经 $(LOCALE_SWIFT_EXEMPT) 的 fixedFormatDateFormatter，且不使用跟随环境的本地化日期 API；"; \
	      echo "  Android 的构造调用写在一行并显式传 Locale.US（Locale.getDefault() 等同于没钉，跨行写法一并判红）。"; \
	      exit 1; \
	    fi; \
	    culture=$$( printf '%s\n' "$$swift_files" \
	                 | xargs grep -HnE 'localizedCaseInsensitive|localizedStandard|localizedCompare|caseInsensitiveCompare|\.(lowercased|uppercased)\(with:' 2>/dev/null \
	                 | grep -vE ':[0-9]+: *(///|//|\*)' || true); \
	    if [ -n "$$culture" ]; then \
	      echo "check locale FAILED —— 字符串比较/折叠跟随当前区域设置："; \
	      printf '%s\n' "$$culture" | sed 's/^/  /'; \
	      echo "  localizedCaseInsensitiveContains 等随 Locale.current 变，同一份输入在不同区域设置下给出不同结果，"; \
	      echo "  也与 Kotlin 侧 ignoreCase 的口径分歧。改用 locale 无关的 lowercased()/uppercased() 再比较"; \
	      echo "  （依据见 ios/Core/Sources/Core/LogKeywordFilter.swift 的同一决定）。"; \
	      echo "  注：按行首注释过滤，行内尾随注释仍会命中——那一侧是假红，改写注释即可。"; \
	      exit 1; \
	    fi; \
	    echo "check locale OK" ;; \
	  size) deno run -A scripts/source-size.ts ;; \
	  theme-palette) \
	    command -v python3 >/dev/null 2>&1 \
	      || { echo "check theme-palette FAILED —— 无 python3，两端调色板比对根本没跑（报 OK 比不跑更糟）"; exit 1; }; \
	    python3 scripts/check-theme-palette.py ;; \
	  android-font-source) \
	    command -v python3 >/dev/null 2>&1 \
	      || { echo "check android-font-source FAILED —— 无 python3，Android 字号来源门禁根本没跑（报 OK 比不跑更糟）"; exit 1; }; \
	    python3 scripts/check-android-font-source.py ;; \
	  android-color-source) \
	    command -v python3 >/dev/null 2>&1 \
	      || { echo "check android-color-source FAILED —— 无 python3，Android 颜色来源门禁根本没跑（报 OK 比不跑更糟）"; exit 1; }; \
	    python3 scripts/check-android-color-source.py ;; \
	  android-radius-source) \
	    command -v python3 >/dev/null 2>&1 \
	      || { echo "check android-radius-source FAILED —— 无 python3，Android 圆角来源门禁根本没跑（报 OK 比不跑更糟）"; exit 1; }; \
	    python3 scripts/check-android-radius-source.py ;; \
	  i18n-placeholder-order) \
	    command -v python3 >/dev/null 2>&1 \
	      || { echo "check i18n-placeholder-order FAILED —— 无 python3，两端占位符次序对账根本没跑（报 OK 比不跑更糟）"; exit 1; }; \
	    python3 scripts/check-i18n-placeholder-order.py ;; \
	  apple-font-source) \
	    command -v python3 >/dev/null 2>&1 \
	      || { echo "check apple-font-source FAILED —— 无 python3，Apple 字号来源门禁根本没跑（报 OK 比不跑更糟）"; exit 1; }; \
	    python3 scripts/check-apple-font-source.py ;; \
	  apple-color-source) \
	    command -v python3 >/dev/null 2>&1 \
	      || { echo "check apple-color-source FAILED —— 无 python3，Apple 颜色来源门禁根本没跑（报 OK 比不跑更糟）"; exit 1; }; \
	    python3 scripts/check-apple-color-source.py ;; \
	  apple-radius-source) \
	    command -v python3 >/dev/null 2>&1 \
	      || { echo "check apple-radius-source FAILED —— 无 python3，Apple 圆角来源门禁根本没跑（报 OK 比不跑更糟）"; exit 1; }; \
	    python3 scripts/check-apple-radius-source.py ;; \
	  apple-handler-defaults) \
	    command -v python3 >/dev/null 2>&1 \
	      || { echo "check apple-handler-defaults FAILED —— 无 python3，回调缺省实现棘轮根本没跑（报 OK 比不跑更糟）"; exit 1; }; \
	    python3 scripts/check-apple-handler-defaults.py ;; \
	  negative-probe-anchors) \
	    command -v python3 >/dev/null 2>&1 \
	      || { echo "check negative-probe-anchors FAILED —— 无 python3，负例探针锚点干跑根本没跑（报 OK 比不跑更糟）"; exit 1; }; \
	    python3 scripts/check-negative-probe-anchors.py ;; \
	  gate-test-pairing) \
	    command -v python3 >/dev/null 2>&1 \
	      || { echo "check gate-test-pairing FAILED —— 无 python3，门与单测的配对判据根本没跑（报 OK 比不跑更糟）"; exit 1; }; \
	    python3 scripts/check-gate-test-pairing.py ;; \
	  failure-path) \
	    command -v python3 >/dev/null 2>&1 \
	      || { echo "check failure-path FAILED —— 无 python3，失败路径门禁根本没跑（报 OK 比不跑更糟）"; exit 1; }; \
	    python3 scripts/check-failure-paths.py ;; \
	  script-tests) \
	    command -v python3 >/dev/null 2>&1 \
	      || { echo "check script-tests FAILED —— 无 python3，配对单测一份都没跑（报 OK 比不跑更糟）"; exit 1; }; \
	    python3 scripts/check-script-tests.py ;; \
	  run-ios-launch-flag) \
	    command -v python3 >/dev/null 2>&1 \
	      || { echo "check run-ios-launch-flag FAILED —— 无 python3，装机启动那两行根本没核（报 OK 比不跑更糟）"; exit 1; }; \
	    python3 scripts/check-run-ios-launch-flag.py ;; \
	  cold-compile) \
	    command -v python3 >/dev/null 2>&1 \
	      || { echo "check cold-compile FAILED —— 无 python3，冷编译告警根本没扫（报 OK 比不跑更糟）"; exit 1; }; \
	    python3 scripts/check-cold-compile.py ;; \
	  commit-script) \
	    command -v python3 >/dev/null 2>&1 \
	      || { echo "check commit-script FAILED —— 无 python3，共用提交脚本的单测根本没跑（报 OK 比不跑更糟）"; exit 1; }; \
	    if bash scripts/commit-own-paths.test.sh >/dev/null; then \
	      echo "check commit-script OK（commit-own-paths.sh 单测全过：判据自身失败放行且喊、冷编译守卫、纯删除、新增门带自陈、逐块清单、归属闸）"; \
	    else \
	      echo "check commit-script FAILED —— 共用提交脚本的单测有用例没过（逐条红因见上面的 FAIL 行）"; exit 1; \
	    fi ;; \
	  negative-case-distinctness) \
	    command -v python3 >/dev/null 2>&1 \
	      || { echo "check negative-case-distinctness FAILED —— 无 python3，负例区分力门禁根本没跑（报 OK 比不跑更糟）"; exit 1; }; \
	    python3 scripts/check-negative-case-distinctness.py ;; \
	  self-scan-declaration) \
	    command -v python3 >/dev/null 2>&1 \
	      || { echo "check self-scan-declaration FAILED —— 无 python3，扫描面自陈门禁根本没跑（报 OK 比不跑更糟）"; exit 1; }; \
	    python3 scripts/check-self-scan-declaration.py --undeclared '$(SELF_SCAN_UNDECLARED)' \
	      --undeclared-ratchet $(SELF_SCAN_UNDECLARED_RATCHET) ;; \
	  module-name-binding) \
	    command -v python3 >/dev/null 2>&1 \
	      || { echo "check module-name-binding FAILED —— 无 python3，模块内重名根本没扫（报 OK 比不跑更糟）"; exit 1; }; \
	    python3 scripts/check-module-name-binding.py ;; \
	  connection-truth-source) \
	    command -v python3 >/dev/null 2>&1 \
	      || { echo "check connection-truth-source FAILED —— 无 python3，连接真相来源根本没扫（报 OK 比不跑更糟）"; exit 1; }; \
	    python3 scripts/check-connection-truth-source.py ;; \
	  apple-handoff-atomic) \
	    command -v python3 >/dev/null 2>&1 \
	      || { echo "check apple-handoff-atomic FAILED —— 无 python3，交接件原子发布判据根本没跑（报 OK 比不跑更糟）"; exit 1; }; \
	    python3 scripts/check-apple-handoff-atomic.py ;; \
	  gate-self-declaration) \
	    command -v python3 >/dev/null 2>&1 \
	      || { echo "check gate-self-declaration FAILED —— 无 python3，门禁自陈两栏的棘轮根本没跑（报 OK 比不跑更糟）"; exit 1; }; \
	    python3 scripts/check-gate-self-declaration.py ;; \
	  ios-hidden-opacity) \
	    command -v python3 >/dev/null 2>&1 \
	      || { echo "check ios-hidden-opacity FAILED —— 无 python3，隐藏视图的无障碍门根本没跑（报 OK 比不跑更糟）"; exit 1; }; \
	    python3 scripts/check-ios-hidden-opacity.py ;; \
	  rule-consistency) \
	    command -v python3 >/dev/null 2>&1 \
	      || { echo "check rule-consistency FAILED —— 无 python3，规则登记一致性门禁根本没跑（报 OK 比不跑更糟）"; exit 1; }; \
	    python3 scripts/check-rule-consistency.py ;; \
	  neutral-contract-parity) \
	    command -v python3 >/dev/null 2>&1 \
	      || { echo "check neutral-contract-parity FAILED —— 无 python3，中立契约一致性门禁根本没跑（报 OK 比不跑更糟）"; exit 1; }; \
	    python3 scripts/check-neutral-contract-parity.py --declarations '$(NEUTRAL_CONTRACT_DIVERGENCES)' ;; \
	  test-legs) \
	    command -v python3 >/dev/null 2>&1 \
	      || { echo "check test-legs FAILED —— 无 python3，测试腿调度门禁根本没跑（报 OK 比不跑更糟）"; exit 1; }; \
	    python3 scripts/check-test-legs.py ;; \
	  lines-and-corners) \
	    command -v python3 >/dev/null 2>&1 \
	      || { echo "check lines-and-corners FAILED —— 无 python3，线条与直角门禁根本没跑（报 OK 比不跑更糟）"; exit 1; }; \
	    python3 scripts/check-lines-and-corners.py --state-fill-ratchet $(LINES_CORNERS_STATE_FILL) \
	      --state-fill-exempt '$(LINES_CORNERS_STATE_FILL_EXEMPT)' ;; \
	  disabled-opacity) \
	    command -v python3 >/dev/null 2>&1 \
	      || { echo "check disabled-opacity FAILED —— 无 python3，禁用态透明度门禁根本没跑（报 OK 比不跑更糟）"; exit 1; }; \
	    python3 scripts/check-disabled-opacity.py --undeclared '$(DISABLED_OPACITY_UNDECLARED)' --ratchet $(DISABLED_OPACITY_RATCHET) ;; \
	  classification-collapse) \
	    command -v python3 >/dev/null 2>&1 \
	      || { echo "check classification-collapse FAILED —— 无 python3，分类塌陷门禁根本没跑（报 OK 比不跑更糟）"; exit 1; }; \
	    python3 scripts/check-classification-collapse.py --known '$(CLASSIFICATION_COLLAPSE_KNOWN)' ;; \
	  doc-allowlist) \
	    python3 scripts/check-doc-allowlist.py $(DOC_ALLOWLIST) ;; \
	  *) echo "用法: make check [rule=$(CHECK_RULES_PIPE)]（缺省跑全部）"; exit 2 ;; \
	esac

# 建一道新门之前先问：仓里已经有一道在守它了吗？
# 用法: make find-duplicate-gate fixture=/tmp/含缺陷的样本.sh as=scripts/zz-probe.sh [rule=新门名]
# 它跑两趟全量（基线 + 投夹具），分钟级 ⇒ 不进 `make check`，建门之前跑一次。
# 判据是由绿翻红，不是「红」——树上可能本来就有常驻红，只看红会把每道新门都判成重复。
find-duplicate-gate:
	@[ -n "$(fixture)" ] && [ -n "$(as)" ] || { echo "用法: make find-duplicate-gate fixture=<含缺陷的样本> as=<仓内落点> [rule=<新门名>]"; exit 2; }
	@python3 scripts/find-duplicate-gate.py --fixture "$(fixture)" --as "$(as)" --rule "$(rule)"

check-negative-gates:
	@[ -n "$(o)" ] || { echo "用法: make check-negative-gates o=/tmp/e11-negative-gates.md"; exit 2; }
	@python3 scripts/check-negative-gates.py -o "$(o)"

# make test 用的门禁子集 = CHECK_RULES 减去 CHECK_TEST_GATES_EXCLUDED。每条排除都要同时带结构化标记
# `check-test-gates-excluded:` 与书面理由（红在什么上、恢复条件是什么），由 check rule=rule-consistency
# 核对变量与标记逐条一致——否则「被漏掉」与「有意不跑」长得一模一样。
CHECK_TEST_GATES_EXCLUDED :=
CHECK_TEST_GATE_RULES := $(filter-out $(CHECK_TEST_GATES_EXCLUDED),$(CHECK_RULES))
#
# 为什么不干脆让 make test 依赖完整 check：判据一旦长期红就会被训练成可以忽略的东西，
# 所以「跑不动的门」要显式排除并写下理由，而不是让整条 make test 永远红。
check-test-gates:
	@# 逐条跑完再汇总，不用 `&&` 短路：短路会让一条常驻红把排在它后面的门全部静默关掉。
	@# 规则集由 CHECK_RULES 减去排除项算出来，与 check 的 all 分支共用同一个遍历形状，不另抄清单。
	@failed=""; \
	for rule in $(CHECK_TEST_GATE_RULES); do \
	  $(MAKE) --no-print-directory check rule=$$rule || failed="$$failed $$rule"; \
	done; \
	if [ -n "$$failed" ]; then \
	  echo "check-test-gates FAILED —— 以下规则未通过：$${failed}"; \
	  echo "  （**逐条跑完再汇总**，不在第一处失败就停 —— 短路会让一条常驻红债把排在它"; \
	  echo "    后面的门全部静默关掉。）"; \
	  exit 1; \
	fi; \
	echo "check-test-gates OK（$(words $(CHECK_TEST_GATE_RULES)) 条规则全部通过；"\
	     "排除 $(words $(CHECK_TEST_GATES_EXCLUDED)) 条，各带书面理由，由 rule-consistency 核）"

# ─────────────────────────────────────────────────────────────
# 引擎构建管线（详见 engine/Makefile；产物落位到两端）
# ─────────────────────────────────────────────────────────────
.PHONY: engine engine-android engine-android-release engine-apple engine-clean sync-store-build
engine: engine-android engine-apple
engine-android:
	$(MAKE) -C engine android
engine-android-release:
	$(MAKE) -C engine android-release
engine-apple:
	$(MAKE) -C engine apple
engine-clean:
	$(MAKE) -C engine clean

sync-store-build:
	deno run -A engine/store-build.ts --os "$(os)" $(if $(dry_run),--dry-run,)

# ─────────────────────────────────────────────────────────────
# 运行：make run os=android | make run os=ios
# 接受参数 os，真机优先，找不到真机则回退模拟器，构建+安装+启动
# ─────────────────────────────────────────────────────────────
IOS_PROJECT := ios/OneBoxM.xcodeproj
IOS_SCHEME := OneBoxM
IOS_CONFIGURATION := Debug
IOS_DERIVED_DATA := ios/build/DerivedData

.PHONY: run run-android run-ios
run:
	@case "$(os)" in \
	  android) $(MAKE) run-android ;; \
	  ios)     $(MAKE) run-ios ;; \
	  *) echo "用法: make run os=android | make run os=ios"; exit 2 ;; \
	esac

run-android:
	@set -eu; \
	device_id="$(android_device)"; \
	if [ -z "$$device_id" ]; then \
		device_id=$$(adb devices -l | awk '$$2 == "device" && $$1 !~ /^emulator-/ { print $$1; exit }'); \
	fi; \
	if [ -z "$$device_id" ]; then \
		device_id=$$(adb devices -l | awk '$$2 == "device" && $$1 ~ /^emulator-/ { print $$1; exit }'); \
	fi; \
	if [ -z "$$device_id" ]; then \
		echo "run-android: 未找到已连接且可用的 Android 真机或模拟器；请连接并授权设备，或用 android_device=<设备标识> 指定。"; \
		exit 2; \
	fi; \
	(cd android && ./gradlew :app:assemblePlayDebug); \
	adb -s "$$device_id" install -r android/app/build/outputs/apk/play/debug/app-play-debug.apk; \
	adb -s "$$device_id" shell am start -n cloud.oneoh.oneboxn/.MainActivity

run-ios:
	@set -eu; \
	device_id="$(ios_device)"; \
	device_kind=""; \
	physical_ios_seen=""; \
	if [ -n "$$device_id" ]; then \
		if xcrun simctl list devices available | awk -v id="$$device_id" 'index($$0, "(" id ")") { found = 1 } END { exit found ? 0 : 1 }'; then \
			device_kind="simulator"; \
		else \
			device_kind="device"; \
		fi; \
	fi; \
	if [ -z "$$device_id" ]; then \
		ios_devices=$$(xcrun devicectl list devices \
			--hide-headers \
			--hide-default-columns \
			--columns identifier,state,reality,platform \
			--timeout 10); \
		: "状态列不按固定列号取：devicectl 在标识符后面还印一列 '(UDID)' 标注它是哪种标识符，"; \
		: "而且状态本身可以含空格（'available (paired)'）。"; \
		: "故取 \$$1 与末两列之间的全部字段（剔除 '(UDID)' 标注）拼成状态，列增删都不影响。"; \
		ios_rows=$$(printf '%s\n' "$$ios_devices" | awk '$$(NF - 1) == "physical" && $$NF == "iOS" { \
			state = ""; \
			for (i = 2; i <= NF - 2; i++) { if ($$i != "(UDID)") state = state (state == "" ? "" : " ") $$i } \
			print $$1 "\t" state \
		}'); \
		physical_ios_seen=$$(printf '%s\n' "$$ios_rows" | awk 'NF { print $$1; exit }'); \
		device_id=$$(printf '%s\n' "$$ios_rows" | awk -F'\t' '$$2 ~ /^(connected|available)/ { print $$1; exit }'); \
		if [ -n "$$device_id" ]; then \
			device_kind="device"; \
		fi; \
	fi; \
	if [ -z "$$device_id" ] && [ -n "$$physical_ios_seen" ]; then \
		echo "run-ios: 检测到 iOS 真机但状态不是 connected/available，禁止回退 Simulator；请解锁、信任设备后重试。"; \
		exit 2; \
	fi; \
	if [ -z "$$device_id" ]; then \
		device_id=$$(xcrun simctl list devices available | awk '/^-- iOS / { in_ios = 1; next } /^-- / { in_ios = 0 } in_ios && /\(Booted\)/ { id = $$(NF - 1); gsub(/[()]/, "", id); print id; exit }'); \
		if [ -n "$$device_id" ]; then \
			device_kind="simulator"; \
		fi; \
	fi; \
	if [ -z "$$device_id" ]; then \
		device_id=$$(xcrun simctl list devices available | awk '/^-- iOS / { in_ios = 1; next } /^-- / { in_ios = 0 } in_ios && /\(Shutdown\)/ { id = $$(NF - 1); gsub(/[()]/, "", id); print id; exit }'); \
		if [ -n "$$device_id" ]; then \
			device_kind="simulator"; \
		fi; \
	fi; \
	if [ -z "$$device_id" ]; then \
		echo "run-ios: 未找到已连接且可用的 iOS 真机或 Simulator；请连接并信任设备，或用 ios_device=<设备标识> 指定。"; \
		exit 2; \
	fi; \
	if [ -z "$$device_kind" ]; then \
		device_kind="device"; \
	fi; \
	if [ "$$device_kind" = "device" ]; then \
		xcodebuild \
			-project "$(IOS_PROJECT)" \
			-scheme "$(IOS_SCHEME)" \
			-configuration "$(IOS_CONFIGURATION)" \
			-destination "id=$$device_id" \
			-derivedDataPath "$(IOS_DERIVED_DATA)" \
			build; \
		app_path="$(IOS_DERIVED_DATA)/Build/Products/$(IOS_CONFIGURATION)-iphoneos/$(IOS_SCHEME).app"; \
	else \
		xcrun simctl bootstatus "$$device_id" -b; \
		open -a Simulator --args -CurrentDeviceUDID "$$device_id"; \
		simulator_architecture=$$(uname -m); \
		xcodebuild \
			-project "$(IOS_PROJECT)" \
			-scheme "$(IOS_SCHEME)" \
			-configuration "$(IOS_CONFIGURATION)" \
			-destination "platform=iOS Simulator,id=$$device_id,arch=$$simulator_architecture" \
			-derivedDataPath "$(IOS_DERIVED_DATA)" \
			build; \
		app_path="$(IOS_DERIVED_DATA)/Build/Products/$(IOS_CONFIGURATION)-iphonesimulator/$(IOS_SCHEME).app"; \
	fi; \
	if [ ! -d "$$app_path" ]; then \
		echo "run-ios: 构建成功，但未找到 app 产物：$$app_path"; \
		exit 2; \
	fi; \
	bundle_id=$$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$$app_path/Info.plist"); \
	if [ "$$device_kind" = "device" ]; then \
		xcrun devicectl device install app --device "$$device_id" "$$app_path"; \
		xcrun devicectl device process launch --terminate-existing --device "$$device_id" "$$bundle_id" $(IOS_SKIP_BACKGROUND_REFRESH); \
	else \
		xcrun simctl install "$$device_id" "$$app_path"; \
		xcrun simctl launch --terminate-running-process "$$device_id" "$$bundle_id" $(IOS_SKIP_BACKGROUND_REFRESH); \
	fi

# `run-ios` 起的是本机构建的 app，它装配期就会排一次后台刷新——到点按用户真实的配置地址联网抓取
# 并覆写 `ProfileStore`，而真机容器里是用户的真配置 ⇒ 装机启动带上这个参数跳过它。
# 要看正常的刷新行为，在设备上点图标启动一次（那一趟不带这个参数）。
# 单一来源是 `ios/App/AppMain.swift` 的 `skipBackgroundRefreshArgument`。
IOS_SKIP_BACKGROUND_REFRESH := -skip-background-refresh

# ─────────────────────────────────────────────────────────────
# 模板资产供给：
# 从 .env（gitignored）读两模式模板完整 URL，拉取后剥 JSONC 注释/尾随逗号转严格 JSON，
# 落位两端（产物 gitignored——模板含明文域名，绝不入仓）。缺 .env 键即报错退出。
#   .env 需含两键（各一条完整 URL）：
#     template_rules=<tun-rules 模板 URL>
#     template_global=<tun-global 模板 URL>
# ─────────────────────────────────────────────────────────────
TEMPLATES_ANDROID_DIR := android/app/src/main/assets/templates
TEMPLATES_IOS_DIR := ios/App/Templates

# JSONC → 严格 JSON：字符串感知地剥 // 与 /* */ 注释、对象/数组收尾前的尾随逗号，
# 末尾 json.loads 校验（本仓 core Json 是严格解析器，输出必须先过标准库校验）。
define TEMPLATES_STRIP_JSONC_PY
import json, sys
src = sys.stdin.read()
out = []
i = 0
n = len(src)
in_string = False
while i < n:
    c = src[i]
    if in_string:
        out.append(c)
        if c == "\\" and i + 1 < n:
            out.append(src[i + 1]); i += 2; continue
        if c == '"':
            in_string = False
        i += 1; continue
    if c == '"':
        in_string = True; out.append(c); i += 1; continue
    if c == "/" and i + 1 < n and src[i + 1] == "/":
        while i < n and src[i] != "\n": i += 1
        continue
    if c == "/" and i + 1 < n and src[i + 1] == "*":
        i += 2
        while i + 1 < n and not (src[i] == "*" and src[i + 1] == "/"): i += 1
        i += 2; continue
    if c == ",":
        j = i + 1
        while j < n and src[j] in " \t\r\n": j += 1
        if j < n and src[j] in "}]":
            i += 1; continue
    out.append(c); i += 1
text = "".join(out)
json.loads(text)
sys.stdout.write(text)
endef
export TEMPLATES_STRIP_JSONC_PY

.PHONY: templates
templates:
	@set -eu; \
	[ -f .env ] || { echo "templates: 缺 .env（gitignored 本机文件，键说明见 Makefile 本节注释）"; exit 2; }; \
	rules_url=$$(sed -n 's/^template_rules=//p' .env | head -n1); \
	global_url=$$(sed -n 's/^template_global=//p' .env | head -n1); \
	[ -n "$$rules_url" ] || { echo "templates: .env 缺 template_rules=<tun-rules 模板完整 URL>"; exit 2; }; \
	[ -n "$$global_url" ] || { echo "templates: .env 缺 template_global=<tun-global 模板完整 URL>"; exit 2; }; \
	mkdir -p "$(TEMPLATES_ANDROID_DIR)" "$(TEMPLATES_IOS_DIR)"; \
	raw=$$(mktemp); validated=$$(mktemp); trap 'rm -f "$$raw" "$$validated"' EXIT; \
	for pair in "tun-rules.json=$$rules_url" "tun-global.json=$$global_url"; do \
	  name=$${pair%%=*}; url=$${pair#*=}; \
	  android_path="$(TEMPLATES_ANDROID_DIR)/$$name"; \
	  ios_path="$(TEMPLATES_IOS_DIR)/$$name"; \
	  curl -fsSL --max-time 30 "$$url" -o "$$raw"; \
	  python3 -c "$$TEMPLATES_STRIP_JSONC_PY" < "$$raw" > "$$validated"; \
	  for destination in "$$android_path" "$$ios_path"; do cp "$$validated" "$$destination"; done; \
	  echo "templates: $$name 已落位：$$android_path, $$ios_path"; \
	done

# ─────────────────────────────────────────────────────────────
# 外链构建期注入：
# 从 .env（gitignored）读外链各键，生成 ios/Links.xcconfig（gitignored——含明文域名，绝不入仓）。
# iOS 由 Version.xcconfig 非可选 #include，缺文件即构建失败（fail-fast，镜像引擎产物模式）。
# 缺 .env 键即报错退出。
#   .env 需含两键（各一条完整 URL）：
#     website=<官网 URL>
#     privacy=<隐私政策 URL>
# xcconfig 中 `//` 起注释——URL 内成对斜杠以 $() 空引用拆分写入，构建期求值还原。
# ─────────────────────────────────────────────────────────────
LINKS_IOS_XCCONFIG := ios/Links.xcconfig

.PHONY: links
links:
	@set -eu; \
	[ -f .env ] || { echo "links: 缺 .env（gitignored 本机文件，键说明见 Makefile 本节注释）"; exit 2; }; \
	website_url=$$(sed -n 's/^website=//p' .env | head -n1); \
	privacy_url=$$(sed -n 's/^privacy=//p' .env | head -n1); \
	[ -n "$$website_url" ] || { echo "links: .env 缺 website=<官网完整 URL>"; exit 2; }; \
	[ -n "$$privacy_url" ] || { echo "links: .env 缺 privacy=<隐私政策完整 URL>"; exit 2; }; \
	accelerate_url=$$(sed -n 's/^accelerate=//p' .env | head -n1); \
	engine_version=$$(sed -n 's/^UPSTREAM_TAG[[:space:]]*:=[[:space:]]*v\{0,1\}//p' engine/Makefile | head -n1); \
	[ -n "$$engine_version" ] || { echo "links: engine/Makefile 缺 UPSTREAM_TAG"; exit 2; }; \
	website_value=$$(printf '%s' "$$website_url" | sed 's#//#/$$()/#g'); \
	privacy_value=$$(printf '%s' "$$privacy_url" | sed 's#//#/$$()/#g'); \
	accelerate_value=$$(printf '%s' "$$accelerate_url" | sed 's#//#/$$()/#g'); \
	ios_tmp=$$(mktemp); \
	trap 'rm -f "$$ios_tmp"' EXIT; \
	{ \
		  echo "// make links 产出（gitignored——含明文域名，绝不入仓）。"; \
		  echo "// URL 内成对斜杠以 \$$() 空引用拆分避开 xcconfig 注释语法，构建期求值还原。"; \
		  echo "WEBSITE_URL = $$website_value"; \
		  echo "PRIVACY_URL = $$privacy_value"; \
		  echo "// 加速代理 base URL：可选键，缺失即空串——加速代理本就允许不配置。"; \
		  echo "ACCELERATE_URL = $$accelerate_value"; \
		  echo "// 引擎版本：单一来源 engine/Makefile 的 UPSTREAM_TAG，App 进程读它不加载引擎。"; \
		  echo "ENGINE_VERSION = $$engine_version"; \
		} > "$$ios_tmp"; \
		if cmp -s "$$ios_tmp" "$(LINKS_IOS_XCCONFIG)" 2>/dev/null; then \
		  echo "links: $(LINKS_IOS_XCCONFIG) 无变化，保持原文件"; \
		else \
		  cp "$$ios_tmp" "$(LINKS_IOS_XCCONFIG)"; \
		  echo "links: $(LINKS_IOS_XCCONFIG) 已生成"; \
		fi

# ─────────────────────────────────────────────────────────────
# 测试聚合：Android JVM 单测 + iOS Core 包本机直跑 + iOS App 层单测（模拟器）+ 版本与命名一致性。
# 只想跑其中一条时，分别起 `engine-test` / `tools-test` / `android-test` / `ios-test`。
# ─────────────────────────────────────────────────────────────
# 在钉住的干净树（`git archive` / `git worktree`）里跑 `make test` 之前，要从活工作树回填 gitignored
# 的构建输入（`check` 只读源码，不需要）：android/app/src/main/assets/templates/、android/app/libs/、
# ios/Engine.xcframework、ios/EngineKit/{EngineLink.xcframework,Sources/EngineKit/include}、
# ios/Links.xcconfig、ios/App/Templates/。
.PHONY: test engine-test tools-test android-test android-device-test android-recovery-latency ios-test
test: check-test-gates version-check engine-test tools-test android-test ios-test
engine-test:
	deno check engine/*.ts engine/store/*.ts
	python3 scripts/test-count-ratchet.py --leg engine --baseline $(TEST_COUNT_BASELINE) --check-baseline -- \
	  deno test -A engine/*.test.ts engine/store/*.test.ts
tools-test:
	deno check scripts/*.ts
	python3 scripts/test-count-ratchet.py --leg tools --baseline $(TEST_COUNT_BASELINE) --check-baseline -- \
	  deno test -A scripts/*.test.ts
	@# 驱动挪进 Python：除了退出码，还要断言每个文件「声明几条就执行了几条」。
	@# unittest 静默不收集写错位置的 test_ 方法，而退出码仍是 0。
	@python3 scripts/run-python-gate-tests.py
# `android/app/src/androidTest/` 下的仪器测试由 `make android-device-test` 调度，不在 `make test` 里：
# `make test` 必须无设备可跑。
# `:app:testPlayDebugUnitTestIsolated` 必须与主 task 一起列在这里：它单独一个 JVM 跑
# `UnawaitedCoroutineFailureTest`（理由在那个类的注释里）。漏列它那条测试就不再执行；棘轮按两个 task
# 的 XML 之和判执行数，会撞上 `declared != executed` 而失败。
android-test:
	python3 scripts/test-count-ratchet.py --leg android --baseline $(TEST_COUNT_BASELINE) \
		--declared-from android/core/src/test --declared-from android/app/src/test --check-baseline -- \
		./android/gradlew --rerun-tasks -p android :core:test :app:testPlayDebugUnitTest :app:testPlayDebugUnitTestIsolated
# ── Android 设备仪器测试（显式调用，不进 make test）────────────────────────────
# `connectedAndroidTest` 跑完会卸载被测应用，连同配置数据一起抹掉 ⇒ 这条命令自己在跑之前备份、
# 跑之后重装并还原。备份落在本机：存在 app 自己的目录里会被卸载一起带走。
#
# 用法: make android-device-test [class=<全限定测试类名>]
#      干净模拟器首跑（设备上本来就没有夹具）加 args=--no-fixtures。
android-device-test:
	python3 scripts/android-device-test.py $(if $(class),--class $(class),) $(args)
# ── 恢复后节点延迟读数的设备判据（显式调用，不进 make test）──────────────────────
# 真导入、真连接，逐个场景（回前台 / 熄屏 / Doze / 杀界面进程 / 断网）做完再回前台，拿回前台后的
# 每一帧读数与连接稳定时的基线比；读数失真、迟迟不出、自动组改选都判红。
# 要求设备上装着 debug 包（harness 只在 debug 源集）且 VPN 授权已给过。
#
# 用法: make android-recovery-latency device=<adb 序列号> profile_url="<配置地址> [<配置地址>...]"
#                                     [scenario=<场景,场景>] [repeat=<每个场景跑几遍>]
android-recovery-latency:
	@[ -n "$(device)" ] && [ -n "$(profile_url)" ] || { \
	  echo '用法: make android-recovery-latency device=<adb 序列号> profile_url="<配置地址> [<配置地址>...]" [scenario=a,b] [repeat=n]'; exit 2; }
	@deno run -A scripts/android-recovery-latency.ts --device "$(device)" \
		$(foreach url,$(profile_url),--profile-url "$(url)") \
		$(if $(scenario),--scenario "$(scenario)",) $(if $(repeat),--repeat "$(repeat)",)
# App 层单测的宿主：iOS 模拟器（引擎带模拟器切片，App 建得出模拟器包）。
# 设备标识因机而异，不入仓：缺省取已启动的 iOS 模拟器，否则取第一台可用的；
# 指定某台用 `make ios-test ios_test_simulator=<UDID>`。
ios_test_simulator ?= $(shell xcrun simctl list devices available 2>/dev/null | awk '/^-- /{ios=($$2=="iOS");next} ios && match($$0,/[0-9A-F]{8}(-[0-9A-F]{4}){3}-[0-9A-F]{12}/){id=substr($$0,RSTART,RLENGTH); if($$0 ~ /\(Booted\)/){print id; found=1; exit} if(first=="")first=id} END{if(!found && first!="")print first}')
ios-test:
	@# 用 `xcrun swift` 而不是裸 `swift`：裸 `swift` 走 PATH，可能先撞上别的工具链（如 ~/.swiftly/bin
	@# 下的旧版本）而报 Swift tools version 不符；`xcrun` 自己解析 Xcode 工具链，与 PATH 无关。
	python3 scripts/test-count-ratchet.py --leg apple-core --baseline $(TEST_COUNT_BASELINE) \
		--declared-from ios/Core/Tests --check-baseline -- \
		xcrun swift test --package-path ios/Core
	@set -eu; \
	[ -n "$(ios_test_simulator)" ] || { echo "ios-test: 未找到可用的 iOS 模拟器；用 ios_test_simulator=<UDID> 指定。"; exit 1; }; \
	result_dir=$$(mktemp -d); \
	trap 'rm -rf "$$result_dir"' EXIT; \
	result_bundle="$$result_dir/OneBoxMTests.xcresult"; \
	python3 scripts/test-count-ratchet.py --leg apple-app --baseline $(TEST_COUNT_BASELINE) \
		--declared-from ios/AppTests --xcresult-path "$$result_bundle" --check-baseline -- \
		xcodebuild test -project $(IOS_PROJECT) -scheme $(IOS_SCHEME) \
			-destination 'platform=iOS Simulator,id=$(ios_test_simulator)' -only-testing:OneBoxMTests \
			-derivedDataPath $(IOS_DERIVED_DATA) -resultBundlePath "$$result_bundle" -quiet

# 无设备 Release 编译，独立于 `make test`。
.PHONY: build build-mode-check debug-build android-debug ios-debug release-build release-symbols ios-build android-release android-benchmark android-baseline-profile
build-mode-check:
	@case "$(BUILD_MODE)" in \
	  debug|release) ;; \
	  *) echo "build: build_mode 必须是 debug|release（当前：$(BUILD_MODE)；请写 .env build_mode=release）"; exit 2 ;; \
	esac
build: build-mode-check
	@case "$(BUILD_MODE)" in \
	  debug)   printf 'build_mode=debug 将构建 Debug 包；输入 DEBUG 继续: '; \
	           read answer; \
	           [ "$$answer" = "DEBUG" ] || { echo "build: 已取消 Debug 构建"; exit 2; }; \
	           $(MAKE) debug-build ;; \
	  release) $(MAKE) release-build ;; \
	esac
debug-build: android-debug ios-debug
android-debug:
	cd android && ./gradlew :app:assemblePlayDebug
ios-debug:
	xcodebuild -project ios/OneBoxM.xcodeproj -scheme OneBoxM -configuration Debug \
		-destination 'generic/platform=iOS' -derivedDataPath ios/build/DebugGate \
		CODE_SIGNING_ALLOWED=NO \
		ENABLE_CODE_COVERAGE=NO CLANG_COVERAGE_MAPPING=NO build
	@# 控制中心控件不单独建：它挂在 App 的依赖与嵌入阶段，由上面这次构建带着建。
release-build: android-release ios-build release-symbols
# 清理本机构建产物。独立于 engine-clean：那条清引擎产物，这条清两端构建输出与 Xcode DerivedData。
.PHONY: build-clean
build-clean:
	@./scripts/clean-local-build.sh
# 设备目标：设备形态本就是出货形态，无签名也能完成编译与链接，是比模拟器更强的门。
ios-build:
	xcodebuild -project ios/OneBoxM.xcodeproj -scheme OneBoxM -configuration Release \
		-destination 'generic/platform=iOS' -derivedDataPath ios/build/BuildGate \
		CODE_SIGNING_ALLOWED=NO \
		ENABLE_CODE_COVERAGE=NO CLANG_COVERAGE_MAPPING=NO build
android-release: engine-android-release
	cd android && ./gradlew :app:assemblePlayRelease :app:bundlePlayRelease
release-symbols:
	@set -eu; \
	stamp=$$(date -u +%Y%m%dT%H%M%SZ); \
	out="target/release-symbols/$$stamp"; \
	mkdir -p "$$out/android" "$$out/ios"; \
	android_mapping="android/app/build/outputs/mapping/playRelease/mapping.txt"; \
	[ -f "$$android_mapping" ] || { echo "release-symbols: 缺 Android R8 mapping：$$android_mapping"; exit 2; }; \
	cp "$$android_mapping" "$$out/android/mapping.txt"; \
	find android/app/build/outputs/native-debug-symbols -name '*.zip' -type f -exec cp {} "$$out/android/" \; 2>/dev/null || true; \
	dsym_root="ios/build/BuildGate/Build/Products/Release-iphoneos"; \
	[ -d "$$dsym_root" ] || { echo "release-symbols: 缺 iOS Release 产物目录：$$dsym_root"; exit 2; }; \
	find "$$dsym_root" -type d -name '*.dSYM' -exec cp -R {} "$$out/ios/" \; ; \
	[ "$$(find "$$out/ios" -name '*.dSYM' -type d | wc -l | tr -d ' ')" -gt 0 ] || { echo "release-symbols: 未找到 iOS dSYM"; exit 2; }; \
	echo "release-symbols: 已归档到 $$out"
android-benchmark:
	cd android && ./gradlew :benchmark:connectedBenchmarkReleaseAndroidTest
android-baseline-profile:
	cd android && ./gradlew :app:generatePlayReleaseBaselineProfile

# ─────────────────────────────────────────────────────────────
# 版本号
# ─────────────────────────────────────────────────────────────
.PHONY: version-check version-set
version-check:
	@set -eu; \
	android_name=$$(sed -n 's/^versionName=//p' android/app/version.properties | head -n1); \
	android_code=$$(sed -n 's/^versionCode=//p' android/app/version.properties | head -n1); \
	ios_name=$$(sed -n 's/^MARKETING_VERSION *= *//p' ios/Version.xcconfig | head -n1); \
	ios_code=$$(sed -n 's/^CURRENT_PROJECT_VERSION *= *//p' ios/Version.xcconfig | head -n1); \
	[ -n "$$android_name" ] || { echo "version-check: 缺 android versionName"; exit 2; }; \
	[ "$$android_name" = "$$ios_name" ] || { echo "version-check: Android $$android_name != iOS $$ios_name"; exit 2; }; \
	case "$$android_code" in ''|*[!0-9]*) echo "version-check: Android versionCode 非整数"; exit 2 ;; esac; \
	case "$$ios_code" in ''|*[!0-9]*) echo "version-check: iOS CURRENT_PROJECT_VERSION 非整数"; exit 2 ;; esac; \
	[ "$$android_code" = "$$ios_code" ] || { echo "version-check: Android build $$android_code != iOS build $$ios_code"; exit 2; }; \
	echo "version-check OK: $$android_name ($$android_code)"
version-set:
	@set -eu; \
	[ -n "$(VERSION)" ] || { echo "version-set: 缺 VERSION=x.y.z"; exit 2; }; \
	case "$(VERSION)" in [0-9]*.[0-9]*.[0-9]*) ;; *) echo "version-set: VERSION 必须是 x.y.z"; exit 2 ;; esac; \
	code=$$(sed -n 's/^versionCode=//p' android/app/version.properties | head -n1); \
	[ -n "$$code" ] || { echo "version-set: 缺 Android versionCode"; exit 2; }; \
	printf 'versionCode=%s\nversionName=%s\n' "$$code" "$(VERSION)" > android/app/version.properties; \
	sed -i '' 's/^MARKETING_VERSION *=.*/MARKETING_VERSION = $(VERSION)/' ios/Version.xcconfig; \
	$(MAKE) version-check

.PHONY: help
help:
	@echo "OneBoxM targets:"
	@echo "  make engine          构建引擎原生库并落位两端（首次 clone 后必跑；engine-android / engine-apple 只做一端）"
	@echo "  make sync-store-build os=android|ios|all [dry_run=1]  商店构建并同步内部测试"
	@echo "  make templates       从 .env 拉取两模式配置模板并落位两端（首次 clone 后必跑）"
	@echo "  make links           从 .env 生成 iOS 外链注入文件（首次 clone 后必跑）"
	@echo "  make build           按 .env build_mode=debug|release 构建；release 会归档 mapping/dSYM"
	@echo "  make run os=android   真机优先，找不到真机则回退模拟器（或 os=ios）"
	@echo "  make test            纯逻辑门禁：check + 版本 + 两端单测（iOS App 层跑模拟器）"
	@echo "                       test 内置的 check 子集 = make check 减去 CHECK_TEST_GATES_EXCLUDED（$(words $(CHECK_TEST_GATES_EXCLUDED)) 条：$(CHECK_TEST_GATES_EXCLUDED)）"
	@echo "  make check           全部门禁；rule=<名> 只跑一条（$(words $(CHECK_RULES)) 条）："
	@echo "                       $(CHECK_RULES_PIPE)"
	@echo "                       这一行与 make check rule=list 同源（Makefile 的 CHECK_RULES），抄不动也漂不了。"
	@echo "  make ios-build / android-release / release-symbols  无设备 Release 编译与符号归档"
	@echo "  make android-benchmark / android-baseline-profile  Android 真机性能任务"
	@echo "  make build-clean     清理本机构建产物：两端 build 目录与 Xcode DerivedData"
	@echo "  make engine-test / tools-test / android-test / ios-test / engine-clean / help"
