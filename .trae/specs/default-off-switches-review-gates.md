# Spec：默认关项 · 触发条件（复评门）登记表

> 版本 1.0 ｜ 创建 2026-10-09 ｜ 状态：🟢 **登记表已建立 + O1–O5 观测点已落地**
> 来源：`dev_docs/20261009/Liri-21模式完成度对照与未达标清单-20261009.md` §四 **P0-1 / P0-2**
> ＋ `dev_docs/20261009/P0-触发条件补全方案-20261009.md`（本表 = 该方案 §二/§三 的落地）
> 关联规则：GR15（Spec-Driven）/ CS01 / CS02 / CS03 / CS06 / R06-008
> ＋ `.trae/rules/development-workflow.md §2.14 规则 5`（搁置/否决必须附触发条件 · 防 CS03 滥用 **R12-1**）

---

## 1. Problem Statement

本仓对**行为变更 / 暴露类能力**一律**默认关**（`.trae/rules/project_rules.md §1.4` 安全开关清单 **15 项**）。但该表只有「默认值 / 生效语义 / 回退方式」三列，**没有"何时重开"的触发条件** ⇒ 与 §2.14 规则 5 的要求仅**部分**满足：

| 事实 | 证据 |
|---|---|
| 15 项中**默认关**者 **10 项**，另加模式门控 `SELF_VERIFY_PATTERN` 共 **11 项** | `core/featureFlags.ts`；`scripts/check-doc-code-consistency.js:147-173` |
| 其中**仅有 2 项**（`OUTPUT_GUARD` / `RESOURCE_GOVERNOR`）在各自 spec 里写了触发条件 | `guardrails-dual-side.md §11` · `resource-governance-default-and-granularity-assessment.md §2.3` |
| 且这 2 项的触发条件是**散文**（"出现真实场景/事故"），**不可观测、不可判定** | 同上 |
| 其余 **9 项**触发条件**缺失**（Bash A2/A4/A5 · `EXECUTION_TWO_PHASE_CANCEL` · `PRO_SECURITY_SUITE` · `UNATTENDED_MODE` · `SELF_VERIFY_PATTERN` 等） | §2 全表 |

⇒ **本 spec 建立单一事实源的登记表**，并为**不可操作**的触发条件补上**可观测信号**（§3 的 O1–O5）。

---

## 2. 登记表（单一事实源）

> 判据要素：**可观测信号 + 阈值 + 观察窗口**（见 `P0-触发条件补全方案` §一-1.1）。
> 复评节奏：**季度复盘**（§2.14「每季度」）或**事件驱动**。
> ⚠️ **本表不含代码语义**；"默认值"的唯一事实源仍是 `featureFlags.ts`（本表只登记"何时重开"）。

| # | 项 | 当前默认 | 触发条件（可操作判据） | 复评节奏 | 依据 |
|:-:|---|:--:|---|---|---|
| 1 | `OUTPUT_GUARD` | false | ① 护栏接入点 **≥4**（含流式 chunk / 工具回传 / 文件写入；**现 6，G-8 已达标**：终稿×2 / 流式 chunk×1 / 工具回传×1 / 文件写入×2，2026-11-16 `report:output-guard-corpus` 复测仍为 6）；② 语料改写文件数 **≤5**（**现 31 / 3388 文件**，改写面 0.91%，同报表 2026-11-16 实测；2026-10-07 基线 47，`guardrails-dual-side.md §10.3`）**持续 ≥1 发布周期**；③ 真实泄漏事故或用户明确要求"默认打码"；④ `project_rules §1.3` 由"无正式用户"变更为"引入用户" | ①② 季度 · ③④ 事件 | `guardrails-dual-side.md §11` |
| 2 | `OUTPUT_GUARD_BLOCK` | false | **跟随 #1**：`OUTPUT_GUARD` 满足且用户要求"发现即阻断" | 随 #1 | `featureFlags.ts:256` |
| 3 | `OUTPUT_GUARD_KEEP_ORIGINAL` | false | **显式 opt-in（无"默认开"计划）**：需 FP 排查且接受"未打码内容落本地事件日志" | 事件 | `guardrails-dual-side.md §10.6` |
| 4 | `RESOURCE_GOVERNOR` | false | ① 观测（O2）：`observedPeakInflight` **≥8**，且 `resourceGovernor:inflight_at_limit` 日志在窗口内出现 **≥3 次**；② 用户要求"后台任务不得挤占人工对话"；③ `project_rules §1.3` 引入正式用户后出现投诉 | ① 季度 · ②③ 事件 | `resource-governance-default-and-granularity-assessment.md §2.3` |
| 5 | `PRO_SECURITY_SUITE` | false | ① 用户/企业场景明确要求高级安全套件；② 出现合规/审计要求。**⚠️ 前置**：其生效面在代码中**未展开**（仅常量，`featureFlags.ts:727`）⇒ 复评前须先定义"套件包含什么"。**2026-11-16 复核**：全仓**零读取点**（仅常量声明 + `SAFETY_SWITCHES` / `featureGate` 断言）⇒ 开 = **无任何行为**；本项**不属"待翻"**，翻转前须先定义生效面 | 事件 | `featureFlags.ts:727` |
| 6 | `UNATTENDED_MODE` | false | ① 用户要求无人值守自动运行（定时/调度驱动）；**前置**：无人在场时的审批策略须先定（与 Ch.13 HITL 冲突面） | 事件 | `featureFlags.ts:92` |
| 7 | ~~`BASH_APPROVED_REVALIDATE`~~ | ✅ **已翻转 → `true`（安全基线）** | **不再是默认关项**；治理见 **§2.2** | — | 第九轮审查 §七（用户裁定 2026-10-09） |
| 8 | `BASH_INTERPRETER_GUARD` | false | ① **真实事件**：出现解释器内联执行（`node -e`/`python -c`/`bun -e`）绕过白名单的证据（观测 O1-B2）；② 用户要求"解释器命令必须确认" | ② 事件 | `featureFlags.ts:292` · `project_rules.md:57` |
| 9 | ~~`BASH_APPROVAL_STRICT`~~ | ✅ **已翻转 → `true`（安全基线）** | **不再是默认关项**；治理见 **§2.2** | — | 用户裁定 2026-10-31（B3 结构化签名已收窄同名放行；真实日志「命令名级放行命中」= 0） |
| 10 | `EXECUTION_TWO_PHASE_CANCEL` | false | ① **真实事件**：取消后底层仍写入/产生副作用（取消不彻底）；② 并发下出现"取消即释放 ⇒ 双跑/重复计费" | 事件 / 季度 | `featureFlags.ts:310` · `execution-lifecycle-ownership.md:158` |
| 11 | ~~`SELF_VERIFY_PATTERN`~~ | ✅ **已翻转 → `true`（用户裁定 2026-11-16）** | **不再是默认关项**。翻转时三条判据**均未达标**（①实测 `verify` 意图命中 **0 会话** < 20；②③ 需开关先开才能采）⇒ 记为**显式豁免裁定**，判据保留为**回退后复评**依据。回退：`FEATURE_SELF_VERIFY_PATTERN=false`（env 最高优先）或设置页「功能开关」关闭。详见 **§2.4.3** | — | `pattern-wiring-closure.md §9-3` |
| 12 | `CODE_RUN_DEEP_SCAN_STRICT` | false | ① **真实事件**：深扫不可用（原生模块缺失 / 平台缺库）期间出现**危险调用漏检**；② 原生深扫在**目标交付环境**稳定可用（`scanStatus='ran'` 比例达 100%）；③ 用户要求"code_run 深扫必须完成" | 事件 / 与 P0-3 联动 | `featureFlags.ts:326` · `.trae/specs/security-decision-verdict.md` |
| 13 | `CLIENT_STREAM_EXECUTION` | false | ① **真实事件**：客户端 `/v1/chat/stream` 出现**未记账工具调用**或**崩溃后重复副作用**（无 executionId 导致）；② 前端/第三方调用方**回归清单通过**（`ChatRequest.executionId` 注入兼容）；③ 与渠道路径记账口径对齐验证（终态事件同构） | 事件 / 与 P0-2 联动 | `featureFlags.ts:338` · `.trae/specs/client-stream-execution.md` |
| 14 | `CHANNEL_TOOL_POLICY` | false | ① 远程通道会话中 `bash` / `file_write` 等执行/写盘工具的调用率与审批拒绝率**可观测**（灰度期基线）；② `messaging` 任务面在灰度期**无「模型自述工具不可用」类反馈**（否则该通道需补类别）；③ 至少 **1 个发布周期**的灰度观察记录 | 季度 / 事件 | `featureFlags.ts`（`CHANNEL_TOOL_POLICY`）· G-2（`dev_docs/20261018/待修复任务清单-20261018.md`） |
| 15 | ~~`SWARM_VERIFY_RETRY`~~ | ✅ **已翻转 → `true`（用户裁定 2026-11-16）** | **不再是默认关项**。四条判据未逐项取证（真机无 verifier 明确判不过的样本）⇒ 记为**裁定翻转**；增量 token 受 **20k 独立上限**约束，超限即不回灌。回退 `FEATURE_SWARM_VERIFY_RETRY=false`。详见 **§2.4.6** | — | `featureFlags.ts` · `app/src/tasks/swarm/AgentSwarm.ts` · E-1 |
| 16 | `PLUGIN_THIRD_PARTY_INPROCESS` | false | **语义订正（2026-11-16）：本项是"逃生闸"，不是"待翻功能"**—— 开 = 第三方插件回到**主进程内** `import` 执行（可读 `.env` / spawn 子进程）= **弱化隔离**。① 前置（P1 子进程宿主）**已达成**（`PLUGIN_HOST_PROCESS` 默认开）；② 市场/安装链路按 `capabilities` 授权；③ 宿主不可用时的降级路径已验证（**不得**静默回进程内）。⇒ **不设"默认开"计划**；放行单个插件请用 `LIRI_PLUGIN_TRUSTED_IDS` | 事件（与 P1 联动） | `featureFlags.ts`（`PLUGIN_THIRD_PARTY_INPROCESS`）· `.trae/specs/plugin-process-isolation.md` |
| 17 | ~~`GOAL_STARTUP_RESUME`~~ | ✅ **已翻转 → `true`（用户裁定 2026-11-16）** | **不再是默认关项**。判据①②③ 未逐项取证（实测本机 4052 个目标中 24h 内 `active`/`blocked` **0 个**）⇒ 记为**裁定翻转**；有界性保留：24h 新鲜窗口 + 单次 5 个 + 触发前二次校验。回退 `FEATURE_GOAL_STARTUP_RESUME=false`。详见 **§2.4.8** | — | `featureFlags.ts` · `app/src/tasks/goal/goalStartupResume.ts` · `project_rules.md §1.4` |
| 19 | ~~`PLAN_SYSTEM_RESUME`~~ | ✅ **已翻转 → `true`（用户裁定 2026-11-16）** | **不再是默认关项**。四条判据未逐项取证（无真实事件样本）⇒ 记为**裁定翻转**；回退 `FEATURE_PLAN_SYSTEM_RESUME=false`（回到一期消息注入）。详见 **§2.4.5** | — | `featureFlags.ts` · `.trae/specs/planner-system-resume.md` · `project_rules.md §1.4` |
| 18 | ~~`PLAN_STARTUP_RESUME`~~ | ✅ **已翻转 → `true`（用户裁定 2026-11-16）** | **不再是默认关项**。判据①部分成立（实测 21 份 `running` 计划长期停在 running，但 >24h 超窗）；②③ 未取证 ⇒ 记为**裁定翻转**；有界性保留：心跳过期 >10min + 24h 窗口 + 单次 5 个。回退 `FEATURE_PLAN_STARTUP_RESUME=false`。详见 **§2.4.5** | — | `featureFlags.ts` · `app/src/tasks/plan/planStartupResume.ts` · `.trae/specs/planner-resumable-dag.md` · `project_rules.md §1.4` |
| 20 | `CHANNEL_INBOUND_ALERTS` | false | **入站阈值告警**（拒绝率突增 / `inflight` 卡死 / 渠道静默）。开 = 每分钟评估并写收件箱（`urgent`），同 `(规则, 渠道)` 静默期落盘去重。判据：① 灰度期**误报率 ≤20%**（每周人工抽查命中项）且真正事故**至少 1 次被提前发现**；② 三条阈值经真实流量校准（无"上线即静默"或"每分钟刷屏"）；③ 用户要求"渠道异常必须主动通知" | 季度 / 事件 | `packages/kernel/src/core/featureFlags.ts`（`CHANNEL_INBOUND_ALERTS`）· `.trae/specs/inbound-message-monitoring-gaps.md §6` |

**未列入（如实边界）**：`iterative_refine` / `parallel_distributed` 的**装配触发条件**已有（`pattern-wiring-closure.md §5/§6`），属"pattern 装配"而非"默认关开关"，本表**不重复登记**（同源去重，§2.14 规则 5）；其**可操作化判据已落入** `pattern-wiring-closure.md **§11**`（2026-10-09 追加，引用 O3/O4）。

### 2.1 已裁定排除项（2026-10-09 P1/P2 批次 · 本批**未实现** · 触发条件登记）

> 背景：`dev_docs/20261009/Liri-21模式完成度对照与未达标清单-20261009.md` §四 的 P1/P2 中，以下 5 项**本批未实现**并登记触发条件（R12-1 / §2.14 规则 5）：
> - **4 项经用户确认「跳过冲突项」**（2026-10-09）：已被既有终局裁定排除、或无第二消费者（实现即违反 CS01/CS03）；
> - **Ch.21（+1）**：执行期 recon 后判定同为"无真实场景"（同 `ExploreAgentStrategy` 提示词级已覆盖），**按同一 CS03 口径重分类**——详见 `.trae/specs/active-exploration-closure.md`。

| 项 | 既有裁定 | 触发条件（何时重开） | 依据 |
|---|---|---|---|
| **Ch.20 优先级下沉到任务级** | ⛔ **暂不实施** | ① 出现"**同一会话内并行推进多个任务且优先级不同**"的真实需求；② **且**已完成「会话内多任务并发」架构评估（含与会话**串行/顶替**语义的冲突消解）——仅 ① 成立时应先解决"会话内并发"，**非**扩优先级枚举 | `resource-governance-default-and-granularity-assessment.md §3.3` |
| **Ch.7 Multi-Agent 协商原语**（提议/异议/承诺） | 未立项（无第二消费者） | 出现"需**协商语义**（而非并行扇出 / 辩论）"的真实协作场景，且现 `AgentSwarm` / `CouncilOrchestrator` **无法表达** | 本报告 §三-B4 |
| **Ch.17 推理策略可插拔**（CoT / ToT / GoD） | 未立项（无第二策略消费者） | 出现"需在**运行期切换推理策略**"的真实需求，且存在 **≥2 个可替换策略**的真实消费方 | 本报告 §三-B5 |
| **Ch.21 主动探索闭环** | 未立项（无真实场景） | ① 出现"需代理**自主提出并验证假设**"的可复现任务样本，且现 `ExploreAgentStrategy`/`ReActLoop` 无法表达；② 引入"科研/开放研究"类产品方向；③ 用户明确要求探索预算/探索-利用权衡 | `.trae/specs/active-exploration-closure.md §5` |
| **SR-1 / SR-2**（secret 扫描覆盖 / FP 收敛） | 未修（共享规则表**需跨模块协同**） | 出现**真实泄漏诉求**（新形态前缀漏检 / database-url 误伤），或与 `memory` 侧就**共享规则表**收紧达成协同 | `guardrails-dual-side.md §10.4` · `预存错误与待处理问题.md` SR-1/SR-2 |

> ⚠️ 与 §2 的 `OUTPUT_GUARD`（#1）**同源**：`OUTPUT_GUARD` 的触发条件②即 SR-1/SR-2 的收敛 ⇒ **只做去重登记、不重复评估**（规则 5）。

### 2.2 Bash 安全姿态三开关治理（第九轮审查 §七 建议 1 / 3 / 4）

> §七 要求：**区分灰度与安全基线** · **记录关闭时由哪层承担替代保护** · **明确启用 / 回滚条件与迁移期限**。
> 默认值事实源仍为 `project_rules §1.4` ∩ `featureFlags.ts`（由 `lint:doc-code` 的 `SAFETY_SWITCHES` 逐项断言）。

| 开关 | 类别 | 默认 | 关闭时**替代保护**（由哪层承担） | 启用条件 | 回滚条件 | 迁移期限 |
|---|:--:|:--:|---|---|---|---|
| `BASH_APPROVED_REVALIDATE`（A2） | ✅ **安全基线** | **`true`**（2026-10-09 翻转） | —（已开启：批准只免"审批交互"，硬拦截仍须过） | —（已是基线） | **2026-11-06（P0-3）起为 legacy 别名（全仓无读取点）**：批准免交互改由 `isApproved` 直接决定 ⇒ 本开关不再影响行为（默认值与断言保留） | — |

> **S1-2（2026-10-11）语义收紧**：`BASH_APPROVED_REVALIDATE` **不再**控制"能否跳过安全拦截层"。硬拦截层
> （路径 / 危险命令 / 危险模式 / AST-危险 / deny / 白名单 / 沙箱）**恒定执行**。
>
> **P0-3（2026-11-06）订正**：该开关此前被读成"开 ⇒ 已批准命令**再弹一次 ask**"，与 `featureFlags.ts`
> 的 A2 文档语义（开 ⇒ ask 不再重复弹卡）**相反** ⇒ 真机出现"批准 → 恢复 → 30ms 后重弹同一张卡"的
> **无限审批环**（`session_mw4sdx7ma4abe32ea4`）。现「批准免审批交互」直接由 `isApproved` 决定，
> 开关降级为 legacy（保留以兼容既有 `FEATURE_BASH_APPROVED_REVALIDATE` 写法）。
| `BASH_INTERPRETER_GUARD`（A4） | 灰度 | `false` | ① `ALLOWED_COMMANDS` 白名单 ② 危险命令/正则/AST 检查 ③ Landlock 沙箱 | ① **真实事件**：解释器内联执行（`node -e` / `python -c` / `bun -e`）绕过白名单；② 用户明确要求"解释器命令必须确认" | 误报率高 / 阻断正常开发流 ⇒ 维持关闭 | **2026-Q4 复评**（§2-#8） |
| ~~`BASH_APPROVAL_STRICT`（A5）~~ | ✅ **已翻转（安全基线）** | `true` | ① `DANGEROUS_BASE_NAMES` 排除（危险命令名不得走命令名级放行）② 精确 hash `isApproved` | **不再是默认关项**（用户裁定 2026-10-31：B3 已把命令名级放行收窄为结构化签名；真实日志「命令名级放行命中」样本 = 0 ⇒ 摩擦 ≈ 0）；回退 `FEATURE_BASH_APPROVAL_STRICT=false` | — |

**告警（§七 建议 5：不长期无告警默认关）**：`tools/bash/BashTool.ts` 的 `warnGraySecuritySwitchesOnce()` ——
进程内**首次构造** BashTool 时，若 A4 仍为 `false` ⇒ 输出**一次** `logger.warn`（列出灰度开关名 + 指向本表），
使"当前安全姿态"可见。A2 / **A5** 翻转为基线后不再出现在该告警中。

---

### 2.3 复评裁定（P2-4，2026-10-10）—— 「是否翻转默认 / 迁移或复评节奏」

> 来源：`dev_docs/20261010/升级优化方案-20261010.md` §3 **P2-4**。
> 口径：**安全默认值的变更属用户裁定**（R07-2）；本表**只汇总既有裁定与节奏**，
> 未获裁定的项一律**维持现状**并给出触发条件 + 复评节奏（**不得**由实现方自行翻转）。

| 项 | 类别 | 默认 | 是否翻转 | 既有裁定来源 | 触发条件（何时重开） | 迁移 / 复评节奏 |
|---|---|:--:|:--:|---|---|---|
| `OUTPUT_GUARD` | 灰度（暴露类能力） | `false` | ✅ **已裁定：维持 `false`** | [`guardrails-dual-side.md §11`](./guardrails-dual-side.md)（2026-10-07 **用户裁定**；5 条依据：仅覆盖终稿 / 本仓语料 42 文件 FP / 唯一有行为后果者仅 `injection_echo` / 单机单用户边际收益低 / 与同族默认关纪律一致） | ① 覆盖范围扩至**流式 chunk / 工具返回值 / 文件写入**；② 出现"未打码导致真实泄露"事件 | **覆盖范围变更后**复评 |
| `BASH_INTERPRETER_GUARD` | 灰度（安全姿态） | `false` | 维持 | §2.2（v7.23.0 同批：维持默认关） | 见 §2.2（解释器内联执行绕过白名单的真实事件） | **2026-Q4** |
| ~~`BASH_APPROVAL_STRICT`~~ | ✅ **已翻转为安全基线** | `true` | ✅ **已翻转（2026-10-31 用户裁定）** | §2.2（B3 结构化签名 + 真实日志 0 样本） | 不再适用（回退开关 `FEATURE_BASH_APPROVAL_STRICT=false`） | — |
| `EXECUTION_TWO_PHASE_CANCEL` | 灰度（执行语义） | `false` | 维持 | §2-#10 | 取消后底层仍写入/产生副作用；或并发下"取消即释放 ⇒ 双跑/重复计费" | **2026-Q4** |
| `CODE_RUN_DEEP_SCAN_STRICT` | 灰度（安全收紧） | `false` | 维持（默认关时靠结果 `scanStatus` 可观测） | §2-#12 · [`security-decision-verdict.md`](./security-decision-verdict.md) | 深扫不可用期间出现**危险调用漏检**；或原生深扫在目标环境稳定可用（`ran` 比例 100%） | **2026-Q4**（与 P0-3 联动） |
| `CLIENT_STREAM_EXECUTION` | 灰度（执行接入） | `false` | 维持（**翻转前置条件已满足**：handler 级用例已补，B2 / 2026-10-10） | §2-#13 · [`client-stream-execution.md §5.1`](./client-stream-execution.md) | 客户端入口出现**未记账工具调用**或崩溃后**重复副作用**；且前端回归清单通过 | **2026-Q4** |
| **bash 内核沙箱**（`sandbox.landlock.bashEnabled`） | **安全姿态（非 featureFlag）** | `false`（且 `failClosed:false`） | 维持 | [`ast-family-phased-plan.md`](./ast-family-phased-plan.md) §8 / R25 · `invariants.md INV-SEC-003` | ① 真实事件：bash 路径出现**越权读写**而静态检查未拦；② Linux 交付环境 helper 稳定可用且**误伤率可接受**（须先灰度观测；该配置项**无 env 开关** ⇒ 翻转须改 `DEFAULT_LANDLOCK_CONFIG` 默认 + 全量回归） | **2026-Q4**（与 P1-6 沙箱真负向门禁联动） |

**跨平台隔离边界**：Windows / macOS **无强隔离后端**（仅静态检查 + 路径收窄）——
该边界已写入 [`.trae/architecture/invariants.md §6`](../architecture/invariants.md)（P1-1 落点），
**不得**把"沙箱能力存在"宣称为"运行时不可越权"。

---

### 2.4 复评批次记录（2026-Q4 · **执行 2026-10-11**）—— 边界收口计划 **B5**

> 来源：`boundary-convergence-plan.md §5`（季度复评项）· §6 批次表 **B5 Q4 复评批**。
> 口径：**逐条读观测判是否满足**（O1–O5）；**结论一律「维持」** —— 依 **R07-2**，翻转默认值的**唯一**路径 = 本表 §2.3 复评 **+ 用户裁定**，本批复评**不自行翻转任何默认值**。

**观测环境（如实，2026-10-11 实测）**

- 运行期数据根：`C:\Users\csdnc\.pyapp`（`data/logs/app.log` + 16 份轮转 ≈ 240 MB / 1.17 M 行 · 会话事件 `data/sessions/**/events.jsonl` · `data/checkpoints/**`）。
- ⚠️ **采样前置未满足（本轮最重要的读数）**：全量日志中 `"level":"debug"` ≈ **0 条**（仅 7 条含 `[DEBUG]` 文本前缀者，且其 `level` 为 `warn`）⇒ **O1-B2 / O1-B3 / O2 / O4 四个 `logger.debug` 观测点在本观测窗内零采样**。这正是 §7-4 已登记风险（观测依赖 DEBUG 级别）的**实际发生**。故对挂这些观测点的项，本轮只能记「**无可判定样本**」，**不得**据此推断为"信号为零 / 需求不存在"。

| 项 | 判据（§2 / §2.3） | 观测读数（2026-10-11 实测） | 结论 | 下一节奏 |
|---|---|---|---|---|
| `BASH_INTERPRETER_GUARD`（#8） | 出现解释器内联执行（`node -e`/`python -c`/`bun -e`）绕过白名单的**真实事件**（观测 **O1-B2**） | `interpreter_command_allowed` = **0**（真实日志 + 全量数据目录）；**且 DEBUG 未开 ⇒ 无样本** | **维持 `false`** | 2026-Q4 / 事件驱动 |
| `BASH_APPROVAL_STRICT`（#9） | **同名不同参**被命令名级放行（观测 **O1-B3**） | `命令名级放行命中` 在**真实日志** = **0**；全量 67 次命中**全部**落在源码 `*.ts` 与 `knowledge/raw` 副本（**代码文本**，非运行期日志）⇒ 仍为**无样本**。旁证：O1-B1 `已批准命令放行`（`info`）真实日志 = **0** ⇒ 本窗**已批准放行路径未触发** | 本窗维持 `false`；**2026-10-31 已翻转 → `true`**（用户裁定：B3 结构化签名已收窄同名放行 + 真实日志 0 样本 ⇒ 实用摩擦 ≈ 0） | — |
| `EXECUTION_TWO_PHASE_CANCEL`（#10） | 取消后底层仍写入 / 并发下"取消即释放 ⇒ 双跑/重复计费" | **无专用观测点**；本窗无相关事件采样 | **维持 `false`**（无可判定样本） | 2026-Q4 / 事件驱动 |
| `CODE_RUN_DEEP_SCAN_STRICT`（#12） | ① 深扫不可用期间出现危险调用漏检；② `scanStatus='ran'` 比例达 **100%** | 真实日志中 `code_run deep scan not executed/not completed` = **0**（无"深扫不可用"事件）；但 **`ran` 成功路径无显式日志 ⇒ 比例不可计算**。⚠️ **同名不同义辨析**：数据目录 `scanStatus` = `partial 630 / complete 19` 属 **rollback 快照**（`security/rollback/FileOperationTracker.ts:316`），**非**本项的 `CodeRunner` `DeepScanStatus`（`ran\|skipped\|failed`，`tools/CodeRunner/staticTypes`）⇒ **不得混算** | **维持 `false`** | 2026-Q4（与 P0-3 联动） |
| `CLIENT_STREAM_EXECUTION`（#13） | 客户端 `/v1/chat/stream` 出现**未记账工具调用** / 崩溃后**重复副作用** | **前置已满足**（B2 补 handler 级用例，见 §2.3）；本窗无相关事件采样 | **维持 `false`**（前置就绪，待真实事件或用户裁定） | 2026-Q4 |
| `PLAN-P2-4` | §2.3 复评裁定本身 | 复核 §2.3 各行**仍为「维持」**；无新裁定依据 | **维持** | 2026-Q4 |
| `OUTPUT_GUARD`（#1，**①② 季度项**） | ① 护栏接入点 **≥4**；② 语料改写文件数 **≤5** | ① 实测接入点 = **2**（`streamMessageFlow.ts:1786` · `ChatOrchestrator.ts:873`）⇒ **未达 ≥4**；② 改写文件数 = **47**（`guardrails-dual-side.md §10.3`）⇒ **未达 ≤5** | **维持 `false`** | ①② 下一季度 / ③④ 事件 |
| `RESOURCE_GOVERNOR`（#4，**① 季度项**） | ① `observedPeakInflight ≥8` **且** `inflight_at_limit` 在窗口内 **≥3 次** | `inflight_at_limit` = **0**（DEBUG 未开 ⇒ 无样本）；`observedPeakInflight` 为**运行时访问器**（不入日志）⇒ **无采样** | **维持 `false`** | ① 下一季度 / ②③ 事件 |
| `SELF_VERIFY_PATTERN`（#11，**① 季度项**） | ① `verify` 意图命中 **≥20 会话**（观测 **O5**：`data.selected=='self_verify'` 按 `sessionId` 去重） | 全量数据目录（21498 文件）中 `pattern/decision` 事件 = **1 条**（`selected='competitive_strategy'`，`session_muy88ntm7icxkfkl9m7`）；`selected=='self_verify'` = **0 会话**（另 106 处 `pattern/decision` 命中为**工具回传中的源码文本**，非事件） | **维持 `false`** | 埋点落地后下一季度 |

**§2.4.1 结论与后续（明确）**

1. **6 项季度项 + 3 项季度子条件，结论均为「维持」**（无一项达到翻转阈值）；**本轮未改任何默认值**（`featureFlags.ts` 逐字未动）。
2. **节奏分类的一处对齐**：`boundary-convergence-plan.md §5` 把 `OUTPUT_GUARD 系列 / RESOURCE_GOVERNOR / SELF_VERIFY_PATTERN` 归入「事件驱动」；而本表 §2 把 **#1①② / #4① / #11①** 标为**季度**。二者**不矛盾**（§5 按"主导节奏"归类，§2 按"逐条件节奏"归类）—— 本批复评**已按 §2 的季度子条件**执行，故结果对两处口径**同时有效**。
3. **观测能力缺口已定位**：O1-B2 / O1-B3 / O2 / O4 为 `debug` 级 ⇒ 只要 DEBUG 未开即**无采样**。**下一季度复评前须先在设置中打开 DEBUG 级别**（否则重复"无样本"）；`O5` 不依赖 DEBUG（读已落盘事件），但其**样本量本身极低**（本机仅 1 条决策事件）⇒ 判据①短期难满足。
4. **未翻转的项不是"欠账"**：均为**已取证的有意默认关**，触发条件在册（§2/§2.3），维持即符合 §2.14 规则 5。

---

### 2.4.2 复评记录（2026-Q4 第二次 · 执行 2026-11-11）—— 仅 `BASH_INTERPRETER_GUARD` (#8)

> 触发：本轮权限收敛收尾（`8af3a9878` 等）后，按 §2.3「2026-Q4 复评」期限执行。

**观测环境（实测）**

- 数据根 `C:\Users\csdnc\.pyapp`：`data/logs/app.log*` **11 份**（最新 6.8 MB + 10 份轮转）；`data/sessions/**/events.jsonl` **205 份**。
- ⚠️ **DEBUG 仍未开启**：全量日志中 `"level":"debug"` = **0 条**，`bash:interpreter_command_allowed` 命中 = **0** ⇒ **O1-B2 依旧无采样**（与 2026-10-11 同因），本项**不以日志读数作结论**。

**替代判据（事件面，可判定）**：读 `events.jsonl` 中 `bash` 工具调用，按 `(node|bun|python3?|perl|ruby)\s+(-e|-c)` 匹配内联解释器，再按其 `toolCallId` 取结果序列：

| 读数 | 数量 | 说明 |
|---|:--:|---|
| 内联解释器调用总数 | **97** | 全部为 `bash` 工具 |
| 被安全门 / 沙箱拦 | **53** | `failureKind='safety_blocked'` 或「沙箱安全检查: 命令包含危险操作」 |
| 停在审批（未执行） | **15** | 结果停在 `awaiting_approval` |
| **实际执行** | **29** | 其中 **26** 条在结果序列里有明确 `awaiting_approval` ⇒ 用户批准后执行 |
| 无审批痕迹 | **3** | `node -e "console.log(process.version)"`（2 例，2026-11-07 前）· `python -c "…PIL…"` |

**结论：维持 `false`**（不自行翻转，依 **R07-2**）——理由：

1. 判据①「解释器内联执行绕过白名单」出现**候选事件**（3 例无审批痕迹），但均为**无害探针**（打印 Node 版本 / 读图片尺寸），无越权或破坏结果；且其中 2 例早于 2026-11-10「命令位锚定」上线，无法据此归因到当前实现。
2. 判据②「用户明确要求解释器命令必须确认」**未出现**；相反，26/29 次执行**已经**经过审批 ⇒ 现有审批层已承担该职责，再翻转会产生**二次确认**摩擦。
3. 关闭期替代保护实测有效：53/97 被安全门拦下，未出现"静默执行"的破坏性样本。

**沙箱 fail-open**（§2.3 末行）：维持。它**不是** featureFlag，翻转须改 `DEFAULT_LANDLOCK_CONFIG` 默认 + 全量回归 + Linux 真负向门禁，属独立立项；Windows 边界仍以 `invariants.md §6` 为准。

**用户裁定（2026-11-11）：维持默认关。** 翻转路径保留 —— 若后续明确要求"解释器命令必须逐条确认"，设 `FEATURE_BASH_INTERPRETER_GUARD=true` 即可；回退同名设 `false`。

---

### 2.4.3 翻转记录（2026-11-16）—— `SELF_VERIFY_PATTERN`（#11）**按用户裁定翻转，判据未达标**

> 触发：用户指令「先处理 21 模式 #4 的开关翻转」；经复述「三条判据均未满足」后，用户裁定 **按裁定翻转（记豁免）**。

**① 取证（如实，2026-11-16 实测）**

| 判据 | 读数 | 判定 |
|---|---|---|
| ① `verify` 意图命中 **≥20 会话**（O5） | `~/.pyapp/data/sessions` 在用 `events.jsonl` **9 份**（含 `.trash` 共 63 份 / `.trash` 外合计 1.1 MB）⇒ `pattern/decision` 事件 **0 条** ⇒ `selected=='self_verify'` 去重会话 **0** | **未达标**（0 / 20） |
| ② 开启后 A/B 质量提升**可量化** | 无 A/B 采集路径（`self-verify-turn-surface.md` §N5 明确不做 A/B 框架） | **无法判定**（需开关先开） |
| ③ 重试增量**可接受（≤10%）** | 同上，需开关先开才有 `maxCycles` 触发的重试样本 | **无法判定** |

**② 落地（代码面）**

| 落点 | 改动 |
|---|---|
| `packages/kernel/src/core/featureFlags.ts` | `SELF_VERIFY_PATTERN: false → true`（注释改写为翻转依据 + 豁免性质 + 回退） |
| `client/src/components/views/SettingsPage.tsx` | 设置页缺键默认 `selfVerifyPattern: false → true`（与后端一致，避免"显示关 / 实际开"） |
| `scripts/check-doc-code-consistency.js` | 从 `REGISTRATION_REQUIRED_FLAGS` 移除该项（不再是默认关项 ⇒ 原 `NAME: false` 断言失效） |
| `app/tests/query/featureGate.test.ts` | 默认回落断言改为 `true`，并新增「用户显式关闭仍生效（回退路径）」 |

**③ 行为影响与回退（必须可撤回）**

- 影响面**仅限命中 verify/refine 意图的回合**：这些回合改走 `failClosed:true` + `maxCycles 2`（refine 为 4），判定更严、可能多一轮重试；其余回合逐字不变。
- **回退（不改代码）**：`FEATURE_SELF_VERIFY_PATTERN=false`（env，优先级最高）或设置页「功能开关 → 自我验证」关闭。
- **判据的后续用途**：①②③ 不再作为"能否开"的门槛（已开），转为**回退后重新开启**的复评依据；若出现"failClosed 导致正常回合被判失败 / 重试显著上升"，先回退再按 ②③ 取证。

> **如实边界**：这是一次**显式豁免裁定**，不是"判据达标后的翻转"。登记表 §2 #11 行与 `featureFlags.ts` 注释均已写明，避免后续把"已翻转"误读为"已验证"。

---

### 2.4.4 翻转记录（2026-11-16）—— `TOOL_DISCLOSURE_STRICT`（21 模式 #5 Tool Use）

> 触发：用户指令「继续执行 21 模式 #5 的开关翻转」（该行在 21 模式表里没有门控开关，经确认对象 = 工具披露面严格预算）。

**前置如实说明**：本项**此前未登记在本表 §2**（它不属于"安全开关"，也不在 `REGISTRATION_REQUIRED_FLAGS`）—— 属**登记遗漏**；本轮翻转后它是**默认开**，故不补登记为默认关项，仅在此留翻转记录与回退方式。

| 项 | 读数 |
|---|---|
| 翻转前默认 | `false`（`featureFlags.ts`） |
| 翻转后默认 | `true`；回退 `FEATURE_TOOL_DISCLOSURE_STRICT=false` |
| 影响面 | 仅 `coding` / `agent` 两个任务面的**工具下发面**（不删工具、不改授权）：实测 coding **40 → 25** 个（provider 4226 → 2663 token）、agent **46 → 25** 个（4811 → 2815 token）；`default` 面不变（13 / 1512）；未列入者仍注册、可经 `tool_search` 检索 |
| 棘轮 | `.trae/architecture/tool-disclosure-baseline.json` 的 `perTask.coding/agent` 已按 `bun run measure:tool-disclosure --update` 下调锁定（40/4226 → 25/2663；46/4811 → 25/2815） |
| 用例同步 | `tests/tools/toolDisclosureStrict.test.ts`：原「默认关 ⇒ 不截断」改为「默认开 ⇒ 有预算」+「显式关（回退路径）⇒ 不截断」 |
| 风险 | 模型每轮可见工具变少（被裁者需 `tool_search` 检索后调用）⇒ 若真机出现"该场景常用工具不可见"的样本，先回退再评估 `STRICT_DISCLOSURE_BUDGETS` / `STRICT_DISCLOSURE_PRIORITY` |
| 用户可配（2026-11-16 追加） | 已登记 `query/featureGate.ts` 的 `USER_CONFIG_KEYS`（键 `toolDisclosureStrict`）⇒ 设置页「工具披露预算（收紧）」可关，**每轮重解析、即时生效**；优先级 `FEATURE_TOOL_DISCLOSURE_STRICT` env > 用户设置 > 静态默认。消费点 `toolCategories.resolveDisclosureBudget` 由 `feature()` 改为 `resolveFeatureGate()` |

---

### 2.4.5 翻转记录（2026-11-16）—— `PLAN_STARTUP_RESUME`（#18）+ `PLAN_SYSTEM_RESUME`（#19）（21 模式 #6 Planning）

> 触发：用户指令「继续执行 21 模式 #6 的开关翻转」；确认范围 = **两个一起翻**（STARTUP 负责发现并登记唤醒，SYSTEM 负责按既有计划续跑；只开 STARTUP 会退回一期消息注入）。

| 项 | 读数 / 处置 |
|---|---|
| 翻转前默认 | 两者均 `false`（`featureFlags.ts`） |
| 翻转后默认 | 两者均 `true`；回退 `FEATURE_PLAN_STARTUP_RESUME=false` / `FEATURE_PLAN_SYSTEM_RESUME=false` |
| 判据①（#18） | **部分成立**：本机 931 份计划中 `status=running` **21 份**（均长期停在 running），但心跳**全部 >24h**（超窗） |
| 判据②③（#18） | **未取证**：需真实重启样本才能测「误续跑率」与「已完成步骤零重做」 |
| 判据①–④（#19） | **未取证**：无"一期续跑新建计划 / 台账停在 running"的真实事件样本 |
| 结论 | **裁定翻转**（不是判据达标后的翻转）；判据保留为**回退后复评**依据 |
| 启动开销（有界性） | 扫描上限 5 个/次 + 心跳过期 >10min + 24h 新鲜窗口 + 触发前二次校验（仍 running 且有未终态步骤且心跳未变，否则作废）；**当下可续跑 0 份** ⇒ 本次启动不会产生额外模型调用 |
| 同步面 | `featureFlags.ts` 注释、`project_rules.md §1.4` 两行（默认/回退/语义）、`check-doc-code-consistency.js` 的 `SAFETY_SWITCHES`（`def: true` + why 改为"已翻为默认开，回退须同批改断言"）、`app/tests/tasks/plan/planStartupResume.test.ts` 的注释（用例本身显式设 env，不受默认值影响） |
| 用户可配（2026-11-16 追加） | 两者均已登记 `query/featureGate.ts` 的 `USER_CONFIG_KEYS`（`planStartupResume` / `planSystemResume`）⇒ 设置页「重启后计划续跑」「计划续跑走执行器」可关；消费点 `planStartupResume.ts`（扫描 + 触发前二次校验）与 `chat/manager/recovery.ts` 由 `feature()` 改为 `resolveFeatureGate()`（env 仍最高优先）。关闭后：下次启动不扫描，已登记的唤醒在二次校验处作废 |

---

### 2.4.6 翻转记录（2026-11-16）—— `SWARM_VERIFY_RETRY`（#15）（21 模式 #7 Multi-Agent）

> 触发：用户指令「继续执行 21 模式 #7 的开关翻转」。多智能体相关默认关项中，只有本项属"编排行为"开关（`TEAM_*` / `PRO_SWARM` 属工具可见性与变体集，不在本表）；消费点唯一：`app/src/tools/AgentTool/swarmPath.ts:560`。

| 项 | 读数 / 处置 |
|---|---|
| 翻转前默认 | `false`；回灌关闭时 verifier 判不过即 `verify:'failed'`，不重试 |
| 翻转后默认 | `true`；回退 `FEATURE_SWARM_VERIFY_RETRY=false` |
| 行为变更 | **仅**在 verifier 给出明确 `pass:false`（含 feedback）时，把 feedback 回灌原 worker **重试 1 次**并重新门禁；verifier 自身故障 / 输出不可解析 / worker 超时 / 批次取消**均不回灌** |
| 成本上界 | 回灌增量 token 受 **`DEFAULT_SWARM_VERIFY_RETRY_TOKEN_BUDGET = 20_000`** 独立上限约束，超限即跳过 |
| 判据取证 | ①"判不过 worker 占比 / 回灌后转通过比例"、②"回灌 token 占比 ≤10%"、③"灰度 1 个发布周期"、④"预算未半途耗尽" —— 真机**无 verifier 明确判不过的样本**（9 份在用 `events.jsonl` 仅 3 处 `swarm` 文本命中，非续跑样本）⇒ **均未取证**，记为**裁定翻转** |
| 同步面 | `featureFlags.ts` 注释、`AgentSwarm.ts` 的 `enableVerifyRetry` 注释（"默认开 + 回退"）；本项不在 `SAFETY_SWITCHES` / `project_rules §1.4`（非安全开关），`lint:doc-code` 断言数不变 |
| 用户可配（2026-11-16 追加） | 已登记 `query/featureGate.ts` 的 `USER_CONFIG_KEYS`（键 `swarmVerifyRetry`）⇒ 设置页「多代理验证重试」可关；消费点 `swarmPath.ts` 由 `feature()` 改为 `resolveFeatureGate()`（env 仍最高优先） |

### 2.4.7 复评记录（2026-11-16）—— Memory Management（21 模式 #8）：**维持默认关**

> 触发：用户指令「继续执行 21 模式 #8 的开关翻转」；经取证与复述后，用户裁定 **维持默认关**。

**① 对象甄别（本模式相关默认关项）**

| 开关 | 消费方 | 结论 |
|---|---|---|
| `REACTIVE_COMPACT` | **全仓零读取点**（仅声明） | 死开关 ⇒ **已于 2026-11-16 删除**（`featureFlags.ts` 独立提交；见下方清理记录） |
| `CONTEXT_COLLAPSE` | 同上 | 同上 |
| `HISTORY_SNIP` | 同上 | 同上 |
| `CONTEXT_COMPACTION_ESCALATION` | `app/src/context/compaction/CompactionOrchestrator.ts:824`（唯一消费点） | **唯一可执行对象** |

> **死开关清理记录（2026-11-16，用户裁定后执行）**：按 `code-deletion.md` CD01–CD06 核查后删除上述三项：
> ① 全仓无 `feature('REACTIVE_COMPACT'|'CONTEXT_COLLAPSE'|'HISTORY_SNIP')` 读取点；
> ② 无 `FEATURE_*` 环境变量名、无构建变体 / 配置注册 / 客户端设置项引用；
> ③ 压缩实现（`packages/compaction` 的 `reactiveCompact`、`packages/query/ReactiveCompact.ts`、
> `ContextCollapseStrategy`、`contextCollapse` 服务）**不读取**这些开关，由各自触发面驱动 ⇒ 删声明不影响能力；
> ④ 回滚：`git revert <sha>`（仅删除 `featureFlags.ts` 的三个键与注释）。

**② 取证读数（`bun run evidence:compaction-escalation`，2026-11-16 实测）**

| 指标 | 读数 | 阈值 |
|---|---|---|
| 可升级面（`decision=skip`） | **0** | ≥ 200 |
| 升级次数（`compaction:escalated`） | 0 | — |
| 压缩事件数（shadow 观测） | 0 | — |
| Tier-3 降幅中位数（升级配对 / 全部） | 无样本 | ≥ 25% |
| 升级后 3 轮内中断率 | 不可判定（需 `events.jsonl` 的 `turn/end`） | — |

**③ 裁定与后续**

- **结论：维持 `false`**（用户裁定 2026-11-16；与脚本自身结论「样本不足 ⇒ 维持默认关」一致）。
- **翻转前提（何时重开）**：可升级面 ≥ 200 且 Tier-3 降幅中位数 ≥ 25% 且升级后 3 轮内中断率可判定并可接受；届时按 G-05 口径复评，**不得据小样本翻默认**。
- **回退/开启方式（不变）**：`FEATURE_CONTEXT_COMPACTION_ESCALATION=true`（运维/灰度可先行）。

---

### 2.4.8 翻转记录（2026-11-16）—— `GOAL_STARTUP_RESUME`（#17）（21 模式 #11 Goal Setting）

> 触发：用户指令「执行吧」（承接 #8 收口后「是否直接跳到 #11（Goal Setting）」的选项），对象 = `GOAL_STARTUP_RESUME`。

| 项 | 读数 / 处置 |
|---|---|
| 翻转前默认 | `false`（不扫描、不登记、不续跑） |
| 翻转后默认 | `true`；回退 `FEATURE_GOAL_STARTUP_RESUME=false` |
| 行为变更 | 启动期扫描「最近 24h 内推进过」的 `active`/`blocked` 目标（按最近更新倒序、单次最多 5 个），各登记一次 `goal-startup:<goalId>:<updatedAt>` 唤醒 → 到点注入 `continue_goal` 续跑会话；触发前二次校验「仍非终态且期间无推进」，陈旧唤醒作废 |
| 判据取证（本机 `task_goals` 实测） | 总数 **4052**（`cancelled` 3056 · `failed` 766 · `active` 229 · `completed` 1）；**24h 内 `active`/`blocked` = 0** ⇒ 本次启动**不会**拉起任何目标，也无额外模型调用 |
| 结论 | **裁定翻转**（判据①②③ 未逐项取证：无误续跑率 / token 台账样本）；判据保留为**回退后复评**依据 |
| 同步面 | `featureFlags.ts` 注释（含实测读数）、`project_rules §1.4` 行、`check-doc-code-consistency.js` 的 `SAFETY_SWITCHES`（`def: true`）、`goalStartupResume.test.ts` 的注释（用例仍显式设 env） |
| 用户可配（2026-11-16 追加） | 已登记 `query/featureGate.ts` 的 `USER_CONFIG_KEYS`（键 `goalStartupResume`）⇒ 设置页「重启后目标续接」可关；`goalStartupResume.ts` 的扫描与二次校验均改为 `resolveFeatureGate()`（env 仍最高优先）。关闭后：下次启动不扫描，历史遗留唤醒同样作废 |

---

### 2.4.9 复评记录（2026-11-16）—— 剩余 **12 项**逐项复评，**全部维持默认关**（用户裁定）

> 触发：用户指令「按登记表逐项处理剩余的默认关项」。先给「12 项 × 实测读数 × 判据结论 × 建议」清单，用户裁定 **全部维持**（不翻任何项）。

| # | 项 | 本轮取证（2026-11-16） | 判据结论 | 处置 |
|:-:|---|---|---|---|
| 1 | `OUTPUT_GUARD` | `report:output-guard-corpus`：接入点 **6**（终稿×2 / 流式 chunk×1 / 工具回传×1 / 文件写入×2）⇒ 判据①**达标**；语料改写 **31 / 3388 文件**（0.91%，基线 47）⇒ 判据②**未达标**（阈值 ≤5） | ① 达标 · ② 未达标 | 维持 |
| 2 | `OUTPUT_GUARD_BLOCK` | 仅在 #1 开启时生效，无独立收益 | 跟随 #1 | 维持 |
| 3 | `OUTPUT_GUARD_KEEP_ORIGINAL` | 开 = 未打码原文落入本地事件日志 | 登记即「显式 opt-in，无默认开计划」 | 维持 |
| 4 | `RESOURCE_GOVERNOR` | 组合根**已注入**抢占回调（`BootPipelineIntegrator`：`setResourceGovernorPreemptHandler` → `abortSessionStream`）+ SSE 观察者 ⇒ 开 = **真实抢占**（>8 在飞且存在低优先跨会话即中止该流）；O2 读数（峰值 / 撞限次数）**与开关无关**，取数口 `GET /v1/diagnostics/resource-governor`（2026-11-17 补齐，此前仅进程内、无出口） | ① 读数可取（**尚无真实样本**）· ②③ 无事件 | 维持 |
| 5 | `PRO_SECURITY_SUITE` | **全仓零读取点**（仅常量 + `SAFETY_SWITCHES` / `featureGate` 断言）⇒ 开 = 无任何行为 | 生效面未展开 | 维持（表行已改标「无生效面 · 不属待翻」） |
| 6 | `UNATTENDED_MODE` | 开 = `ask_user_question` 自动代答（`resolveUnattendedAnswers`）+ 计划自动审批 | 前置「无人值守审批策略」未定 | 维持 |
| 8 | `BASH_INTERPRETER_GUARD` | 开 = 白名单内的 node/bun/python 等转**人工确认**（本仓大量 `bun run` 会加摩擦）；O1-B2 现有采样无解释器绕过白名单证据 | 2026-11-11 已裁定维持；无新事件 | 维持 |
| 10 | `EXECUTION_TWO_PHASE_CANCEL` | 两段式主体未开；注：P36-b 的 `ownershipDecision.action === 'queue'` 分支**已复用**其有界等待实现（`messageRouter`） | ① 无真实事件 | 维持 |
| 12 | `CODE_RUN_DEEP_SCAN_STRICT` | 开 = `scanStatus='skipped'/'failed'` 一律 `security-rejected`；`scanStatus` 有输出字段但**无跨环境统计** | ② 需目标环境 `ran` 达 100%，无数据 | 维持 |
| 13 | `CLIENT_STREAM_EXECUTION` | 客户端**不发** `execution_id`（由服务端 `acquire` 注入）；开 = 客户端流式并入租约链路（拿不到租约 ⇒ 409 `SESSION_BUSY`） | ② 前端回归清单未跑 | 维持 |
| 14 | `CHANNEL_TOOL_POLICY` | 必开守卫 `CHANNEL_UNTRUSTED_TAINT` 已恒拦副作用工具（与开关无关）；本开关只叠加 `messaging` 类目面，而该面会**误裁** `mcp`/`calendar`/`doc` 只读工具；`mobile` 已常开 | ① 灰度基线无数据 | 维持 |
| 16 | `PLUGIN_THIRD_PARTY_INPROCESS` | 开 = 第三方插件回**主进程** `import`（可读 `.env` / spawn）= **弱化隔离**；前置已由 `PLUGIN_HOST_PROCESS`（默认开）承担 | 语义为逃生闸，无默认开合理性 | 维持（表行已改标「逃生闸 · 无默认开计划」） |

**同步面**：本批**未改任何默认值** ⇒ `featureFlags.ts` / `project_rules §1.4` / `check-doc-code-consistency.js` 的 `SAFETY_SWITCHES` **三处零变更**（`bun run lint:doc-code` 复核一致）；仅本表读数与标签订正。

**回退方式（不变）**：逐项 `FEATURE_<NAME>=true` 即可灰度开启（#1 族须先开 `OUTPUT_GUARD`）。

---

## 3. 观测点 O1–O5（触发条件可操作化的**使能步**）

> 口径：**均不新增开关、不改默认值、不改决策**；仅让触发条件"可读"。

| ID | 落点 | 观测形态 | 服务的触发条件 | 状态 |
|:--:|---|---|---|---|
| **O1-B1** | `tools/bash/BashTool.ts`（已批准放行点，`:534`） | 既有 `logger.info('已批准命令放行', { revalidated })` | #7 | ✅ **既有**（无需改） |
| **O1-B2** | `tools/bash/BashTool.ts`（解释器即将执行点） | 新增 `logger.debug('bash:interpreter_command_allowed')` | #8 | ✅ **已落地**（2026-10-09） |
| **O1-B3** | `permission/ApprovedCommandRegistry.ts` `isCommandNameApproved` | 新增 `logger.debug('命令名级放行命中')` | #9 | ✅ **已落地**（2026-10-09） |
| **O2** | `resourceGovernor/index.ts` `admit()`/`release()` | 新增**与开关无关**的观测集 `observedInflight` + 峰值访问器 `observedPeakInflight` + 撞限计数 `observedLimitHits` + `logger.debug('resourceGovernor:inflight_at_limit')`；**取数口** `GET /v1/diagnostics/resource-governor`（2026-11-17，返回 `enabled/limit/inflightCount/observedPeakInflight/observedLimitHits`，默认关也可读） | #4 | ✅ **已落地**（2026-10-09 观测点 / 2026-11-17 补读数出口） |
| **O3** | `query/VerifierAgent.ts` / `query/TAORLoop.ts` | **既有**：`验证完成`（含 `turnCount`/`verdict`，`:373`）· `验证循环已达上限，强制升级`（`:316`）· TAORLoop `REJECT/ESCALATE`（含 `cycleCount`，`:953/:963`） | `iterative_refine` 判据 | ✅ **既有**（无需改） |
| **O4** | `tasks/PlanDrivenLoop.ts` `:780` · `ai/router/OrchEngine.ts` `:194` | 新增 `logger.debug('pdl:topo_batches')` / `logger.debug('orch:topo_batches')`（批数 + 批宽分布 + 最大批宽） | `parallel_distributed` 判据 | ✅ **已落地**（2026-10-09） |
| **O5** | `chat/ChatManager.ts` `_persistPatternDecision`（`:3958`）→ **2026-11-15 起主落点为** `chat/manager/verifyRecipeTurn.ts`（轮首判定） | 会话事件 `pattern/decision`（含 `sessionId` + `selected` + `featureGate.enabled`）。**聚合方式**：查该事件中 `data.selected=='self_verify'\|'iterative_refine'` 者，按 `sessionId` 去重计数。**2026-11-15 观测面订正**：原落点只在 PDCA 长任务闸门内（`site='research_dispatch'`）⇒ 普通轮永不落盘、判据① 结构性采不到样（本机 118 份 `events.jsonl` / 162.1 MB 实测 **0 条**）⇒ 已把判定前移到**每轮入口**，落 `site='turn_dispatch'`（`.trae/specs/self-verify-turn-surface.md`） | #11 | ✅ **已落地**（2026-11-15，`turn_dispatch`；`research_dispatch` 保留） |

**净结果**：需补的 **3 个观测点（O1-B2 / O2 / O4）已落地**；**O1-B1 / O3 / O5 经复核为既有信号**（CS01：不重复造）。

### 3.1 观测语义的**如实局限**

1. **O2 的峰值来自"准入—释放"配对**：若某会话 `admit` 后从未 `release`（异常路径），观测集会同 `inflight` 一样滞留 —— 与既有语义同源，**非本轮引入**。
2. **O1-B3 只证明"命令名级命中"，不直接证明"参数不同"**：当前观测记录 `baseCommand` 命中；"同名**不同参**"的严格判定需比对批准 hash 与本次 hash（本表据其为**代理信号**，严格判定留待触发条件满足时的复评批次）。
3. **O3 的"轮次"以 `cycleCount` / `turnCount` 表达**：`maxCycles` 用尽在实现中表现为 **ESCALATE**（`VerifierAgent.ts:315-327`），非 REJECT ⇒ `iterative_refine` 判据应读**"强制升级"频次**，非"REJECT 比例"（对 `P0-触发条件补全方案` §二-D1 的**如实修正**）。
4. **观测为 `debug` 级**：受日志查看器（设置 → 日志）的 DEBUG 开关控制；季度复评前需确认该级别已开启（否则无采样）。**O2 例外（2026-11-17）**：峰值与撞限次数经 `GET /v1/diagnostics/resource-governor` 直接读取，**不依赖日志级别**；但计数为**进程内**累计，进程重启即清零 ⇒ 复评取数须在**同一进程**内完成（或用日志做跨重启佐证）。

---

## 4. 机制与门禁边界

| 项 | 约定 |
|---|---|
| **单一事实源** | 本表（`§2`）为"触发条件"唯一事实源；`project_rules.md §1.4` 保持"默认值"事实源，**不**把散文塞进规则表 |
| **门禁边界** | §2.14 规则 5 明确"触发条件**不是门禁**（判据含散文语义，不可机械化）" ⇒ **不**对触发条件**内容**做 CI 断言。**可机械化**的只有「**登记完整性**」：每个默认关项（默认关的安全开关 + `SELF_VERIFY_PATTERN`）**必须在本表有条目**。✅ **已落地（2026-10-09）**：`scripts/check-doc-code-consistency.js` 新增 `REGISTRATION_ASSERTIONS`（1 条**存在性守卫**放 code 侧 —— 删表即**失败**而非静默跳过；+ 11 条逐项 docs 断言），`bun run lint:doc-code` 断言数 **23 → 34** |
| **复评执行** | 季度复盘逐项读 O1–O5 观测判是否满足；事件类（#5/#6/#7/#8/#9/#10）即时响应 |
| **同源去重** | 终局裁定后，同源提议**只做去重登记、不重复评估**（§2.14 规则 5 末句）；本表与 `cs03-abuse-forward-assessment.md` 登记表**交叉引用不冲突** |

---

## 5. 合规检查清单

| 规则 | 结论 |
|---|---|
| GR15 Spec-Driven | ✅ 本 spec 先行（登记表 + 观测点）；观测点已在实施记录（§6）逐条落点 |
| **CS01 归一化** | ✅ **O1-B1 / O3 / O5 复核为既有信号 ⇒ 不重复造**（`已验证`）；O2 复用既有 `resourceGovernor` 单例，未新建模块 |
| CS02 状态判定 | ✅ 触发判据用**结构化字段**（`observedPeakInflight` / 事件 `featureGate.enabled` / 日志字段），**禁止**用用户可见字符串判定 |
| **CS03 回退最小化** | ✅ 观测点**零行为变更**（不读开关改决策、不新增默认开关）；拒绝为"观测"新造开关 |
| CS04 Mock 零容忍 | ✅ 无 mock / 无占位实现 |
| CS06 证据驱动 | ✅ §1/§3 逐条 `file:line`；**未展开**（#5 生效面）与**未验证**（#11 埋点）已如实标注 |
| R06-008 分层 | ✅ 改动均在既有层内（`tools` / `permission` / `resourceGovernor` / `tasks` / `ai/router`），**无新增跨层边** |
| R12-1 防 CS03 滥用 | ✅ 本表是该规则"搁置必须附触发条件"的**集中落点** |
| §2.14 规则 5 | ✅ 覆盖 §2.14「搁置/否决必须附触发条件」；复评节奏对齐"每季度" |

---

## 6. 实施记录（2026-10-09）

**落点（实测）**

| 观测点 | 文件 | 改动 |
|:--:|---|---|
| O2 | `app/src/resourceGovernor/index.ts` | 新增 `observedInflight: Set<string>` + `observedPeak` + `get observedPeakInflight()` + `observeInflight()`；`admit()` 首行登记、`release()` 首行移除、`reset()` 清空 |
| O4-a | `app/src/tasks/PlanDrivenLoop.ts` | `scheduleTopoBatches` 后新增 `logger.debug('pdl:topo_batches', …)` |
| O4-b | `app/src/ai/router/OrchEngine.ts` | `scheduleTopoBatches` 后新增 `logger.debug('orch:topo_batches', …)` |
| O1-B2 | `app/src/tools/bash/BashTool.ts` | 解释器确认分支之后新增 `logger.debug('bash:interpreter_command_allowed', …)`（仅日志） |
| O1-B3 | `app/src/permission/ApprovedCommandRegistry.ts` | `isCommandNameApproved` 命中分支新增 `logger.debug('命令名级放行命中', …)`（仅日志） |

**零行为变更论证**
- O2：观测集与 `inflight` **相互独立**；`admit()`/`release()`/`reset()` 的**决策与返回值逐字不变**；`snapshot()`/`count()` 仍受 `governorEnabled()` 约束（未改）。
- O4/O1：仅新增 `logger.debug`；未改任何分支条件、未改返回值。
- O1-B2：`isHighCapabilityInterpreter(command)` 原为**短路内调用**（纯函数、无副作用）⇒ 提为独立判断**不改变结果**。

**待办（明确，本轮未做）**
1. `scripts/check-doc-code-consistency.js` 的**登记完整性**断言（每个默认关项必须在本表有条目）—— ✅ **已落地（2026-10-09）**：新增 `REGISTRATION_ASSERTIONS`（1 条存在性守卫 + 逐项；A2 翻转为基线后为 **10** 条），断言总数 **23 → 34**。
2. `iterative_refine` / `parallel_distributed` 触发条件的**可操作化** —— ✅ **已落地（2026-10-09）**：`pattern-wiring-closure.md` **§11** 追加（引用 O3/O4）。
3. **`SELF_VERIFY_PATTERN`（#11）的 `verify` 意图命中聚合** —— ✅ **已确认无需代码（2026-10-09）**：`_persistPatternDecision`（`ChatManager.ts:3958`）已把 `pattern/decision` 事件（含 `sessionId` + `selected`）落盘 ⇒ 聚合 = 读事件按 `sessionId` 去重计数（详见 §3-O5 行）；新增计数器会与事件**重复表达同一事实**（违 CS01）。

---

## 7. 风险与边界（如实）

1. **阈值是建议值**（`≥8` / `≤5` / `≥20` / `≤10%` 等），须在复评时按真实数据校准；本表不保证其"正确"，只保证其"可判定"。
2. **本表不改变任何默认值**：`featureFlags.ts` 逐字未动。
3. **`PRO_SECURITY_SUITE` 的触发条件当前无对象**（生效面未展开）⇒ 其行以"前置缺口"标注，**不得**据此宣称"已具备高级安全套件"。
4. **观测依赖 DEBUG 日志级别**：若用户关闭 DEBUG，O1/O4 采样为空 ⇒ 复评时须先确认级别。
5. **未跑端到端**：本轮为静态改动 + 门禁（见 §6），**未**在真实会话语境观察日志产出。
