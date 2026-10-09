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
| 1 | `OUTPUT_GUARD` | false | ① 护栏接入点 **≥4**（含流式 chunk / 工具回传 / 文件写入；现 2）；② 语料改写文件数 **≤5**（现 47，`guardrails-dual-side.md §10.3`）**持续 ≥1 发布周期**；③ 真实泄漏事故或用户明确要求"默认打码"；④ `project_rules §1.3` 由"无正式用户"变更为"引入用户" | ①② 季度 · ③④ 事件 | `guardrails-dual-side.md §11` |
| 2 | `OUTPUT_GUARD_BLOCK` | false | **跟随 #1**：`OUTPUT_GUARD` 满足且用户要求"发现即阻断" | 随 #1 | `featureFlags.ts:256` |
| 3 | `OUTPUT_GUARD_KEEP_ORIGINAL` | false | **显式 opt-in（无"默认开"计划）**：需 FP 排查且接受"未打码内容落本地事件日志" | 事件 | `guardrails-dual-side.md §10.6` |
| 4 | `RESOURCE_GOVERNOR` | false | ① 观测（O2）：`observedPeakInflight` **≥8**，且 `resourceGovernor:inflight_at_limit` 日志在窗口内出现 **≥3 次**；② 用户要求"后台任务不得挤占人工对话"；③ `project_rules §1.3` 引入正式用户后出现投诉 | ① 季度 · ②③ 事件 | `resource-governance-default-and-granularity-assessment.md §2.3` |
| 5 | `PRO_SECURITY_SUITE` | false | ① 用户/企业场景明确要求高级安全套件；② 出现合规/审计要求。**⚠️ 前置**：其生效面在代码中**未展开**（仅常量，`featureFlags.ts:404`）⇒ 复评前须先定义"套件包含什么" | 事件 | `featureFlags.ts:404` |
| 6 | `UNATTENDED_MODE` | false | ① 用户要求无人值守自动运行（定时/调度驱动）；**前置**：无人在场时的审批策略须先定（与 Ch.13 HITL 冲突面） | 事件 | `featureFlags.ts:92` |
| 7 | ~~`BASH_APPROVED_REVALIDATE`~~ | ✅ **已翻转 → `true`（安全基线）** | **不再是默认关项**；治理见 **§2.2** | — | 第九轮审查 §七（用户裁定 2026-10-09） |
| 8 | `BASH_INTERPRETER_GUARD` | false | ① **真实事件**：出现解释器内联执行（`node -e`/`python -c`/`bun -e`）绕过白名单的证据（观测 O1-B2）；② 用户要求"解释器命令必须确认" | ② 事件 | `featureFlags.ts:292` · `project_rules.md:57` |
| 9 | `BASH_APPROVAL_STRICT` | false | ① **真实事件**：**同名不同参**被命令名级放行（观测 O1-B3）；② 与 #7/#8 同批复评（三者构成 Bash 安全姿态一组） | 与 #7/#8 同批 | `featureFlags.ts:299` · `project_rules.md:58` |
| 10 | `EXECUTION_TWO_PHASE_CANCEL` | false | ① **真实事件**：取消后底层仍写入/产生副作用（取消不彻底）；② 并发下出现"取消即释放 ⇒ 双跑/重复计费" | 事件 / 季度 | `featureFlags.ts:310` · `execution-lifecycle-ownership.md:158` |
| 11 | `SELF_VERIFY_PATTERN` | false | 须**同时**满足：① `verify` 意图命中 **≥20 会话**（观测 O5）；② 开启后 A/B 显示质量提升**可量化**；③ 重试增量**可接受**（建议 ≤10%） | 埋点落地后下一季度 | `pattern-wiring-closure.md §9-3` |

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
| `BASH_APPROVED_REVALIDATE`（A2） | ✅ **安全基线** | **`true`**（2026-10-09 翻转） | —（已开启：批准只免"审批交互"，硬拦截仍须过） | —（已是基线） | 出现"复检导致正常已批准流程**大面积阻塞**"的真实回归 ⇒ `FEATURE_BASH_APPROVED_REVALIDATE=false`（灰度回退） | — |
| `BASH_INTERPRETER_GUARD`（A4） | 灰度 | `false` | ① `ALLOWED_COMMANDS` 白名单 ② 危险命令/正则/AST 检查 ③ Landlock 沙箱 | ① **真实事件**：解释器内联执行（`node -e` / `python -c` / `bun -e`）绕过白名单；② 用户明确要求"解释器命令必须确认" | 误报率高 / 阻断正常开发流 ⇒ 维持关闭 | **2026-Q4 复评**（§2-#8） |
| `BASH_APPROVAL_STRICT`（A5） | 灰度 | `false` | ① `DANGEROUS_BASE_NAMES` 排除（危险命令名不得走命令名级放行）② 精确 hash `isApproved` | **真实事件**：**同名不同参**被命令名级放行（观测 O1-B3） | 审批摩擦过大 ⇒ 维持关闭 | **2026-Q4 复评**（§2-#9） |

**告警（§七 建议 5：不长期无告警默认关）**：`tools/bash/BashTool.ts` 的 `warnGraySecuritySwitchesOnce()` ——
进程内**首次构造** BashTool 时，若 A4/A5 仍为 `false` ⇒ 输出**一次** `logger.warn`（列出灰度开关名 + 指向本表），
使"当前安全姿态"可见。A2 翻转为基线后不再出现在该告警中。

---

## 3. 观测点 O1–O5（触发条件可操作化的**使能步**）

> 口径：**均不新增开关、不改默认值、不改决策**；仅让触发条件"可读"。

| ID | 落点 | 观测形态 | 服务的触发条件 | 状态 |
|:--:|---|---|---|---|
| **O1-B1** | `tools/bash/BashTool.ts`（已批准放行点，`:534`） | 既有 `logger.info('已批准命令放行', { revalidated })` | #7 | ✅ **既有**（无需改） |
| **O1-B2** | `tools/bash/BashTool.ts`（解释器即将执行点） | 新增 `logger.debug('bash:interpreter_command_allowed')` | #8 | ✅ **已落地**（2026-10-09） |
| **O1-B3** | `permission/ApprovedCommandRegistry.ts` `isCommandNameApproved` | 新增 `logger.debug('命令名级放行命中')` | #9 | ✅ **已落地**（2026-10-09） |
| **O2** | `resourceGovernor/index.ts` `admit()`/`release()` | 新增**与开关无关**的观测集 `observedInflight` + 峰值访问器 `observedPeakInflight` + `logger.debug('resourceGovernor:inflight_at_limit')`（每次达/超上限一条，供出现次数计数） | #4 | ✅ **已落地**（2026-10-09） |
| **O3** | `query/VerifierAgent.ts` / `query/TAORLoop.ts` | **既有**：`验证完成`（含 `turnCount`/`verdict`，`:373`）· `验证循环已达上限，强制升级`（`:316`）· TAORLoop `REJECT/ESCALATE`（含 `cycleCount`，`:953/:963`） | `iterative_refine` 判据 | ✅ **既有**（无需改） |
| **O4** | `tasks/PlanDrivenLoop.ts` `:780` · `ai/router/OrchEngine.ts` `:194` | 新增 `logger.debug('pdl:topo_batches')` / `logger.debug('orch:topo_batches')`（批数 + 批宽分布 + 最大批宽） | `parallel_distributed` 判据 | ✅ **已落地**（2026-10-09） |
| **O5** | `chat/ChatManager.ts` `_persistPatternDecision`（`:3958`） | **既有**会话事件 `pattern/decision`（含 `sessionId` + `selected` + `featureGate.enabled`，`researchIntent \|\| verifyIntent` 时落一条）。**聚合方式**：查 `pattern/decision` 事件中 `data.selected=='self_verify'` 者，按 `sessionId` 去重计数 ⇒ **无需新增代码**（事件已是聚合来源，CS01） | #11 | ✅ **既有**（无需改） |

**净结果**：需补的 **3 个观测点（O1-B2 / O2 / O4）已落地**；**O1-B1 / O3 / O5 经复核为既有信号**（CS01：不重复造）。

### 3.1 观测语义的**如实局限**

1. **O2 的峰值来自"准入—释放"配对**：若某会话 `admit` 后从未 `release`（异常路径），观测集会同 `inflight` 一样滞留 —— 与既有语义同源，**非本轮引入**。
2. **O1-B3 只证明"命令名级命中"，不直接证明"参数不同"**：当前观测记录 `baseCommand` 命中；"同名**不同参**"的严格判定需比对批准 hash 与本次 hash（本表据其为**代理信号**，严格判定留待触发条件满足时的复评批次）。
3. **O3 的"轮次"以 `cycleCount` / `turnCount` 表达**：`maxCycles` 用尽在实现中表现为 **ESCALATE**（`VerifierAgent.ts:315-327`），非 REJECT ⇒ `iterative_refine` 判据应读**"强制升级"频次**，非"REJECT 比例"（对 `P0-触发条件补全方案` §二-D1 的**如实修正**）。
4. **观测为 `debug` 级**：受日志查看器（设置 → 日志）的 DEBUG 开关控制；季度复评前需确认该级别已开启（否则无采样）。

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
