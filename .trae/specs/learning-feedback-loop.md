// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

# Spec：学习反馈闭环（Agentic 模式 #9 Learning and Adaptation）

- **状态**：**M1 ~ M8 已落地（2026-11-15）**；后续见 §5-M9
- **来源**：`dev_docs/20261114/今日计划-2026-11-14.md` §4.1 逐项审计 —— 21 模式中 **#9 是唯一"部分"级缺口**（其余三处为有条件实现：#4 自校验档 / #17 ToT / #21 探索）
- **关联 spec**：`learning-gate-regression-audit.md`（M6 真实回归审计）· `sop-observation-metrics.md`（M7 SOP 观察期度量）· `prompt-snippet-injection-redline.md`（M9 红线设计，未落地）· `online-quality-evaluation.md`（U4 在线打分）· `cross-path-evaluation-write-side.md`（三路评价写入面，结论：**互不相通**）
- **一句话**：把「有信号（turn/quality）→ 有离线评测（evals）→ 有制品（SOP）」三段接成**受控**闭环，中间补上缺失的**归因层**与**候选台账**。

---

## 1. 现状（全部回仓取证）

| 环节 | 现有实现 | 生产者 | 消费者 | 缺口 |
|---|---|---|---|---|
| 在线质量信号 | `packages/evals/src/evals/online/turnQualityEvaluator.ts`（启发式为主 + 仅可疑轮 LLM 复核） | 空闲期 `runTurnQualityPass`，落 `turn/quality` 会话事件 | 仅 `AutoDream` 经 `ISessionQualityPort` 读**汇总** | 分数**未被任何"改进动作"消费** ⇒ 只度量不改进 |
| 离线评测 | `packages/evals/src/evals/{cli,runner,scoring,repoTestJudge}.ts`，`baseline.json` / `signal-baseline.json` 支持 `--gate` 回归阻断 | 人写的静态语料 `evals/tasks/{liri-core,security-injection,source-derived,smoke}.ts` | 发布前 CI/手动 | 语料是**静态 TS 文件**，没有"线上 badcase → 语料"的入库通道（审计 grep `UserSimulator`/`goldenDataset`/`trajectoryPipeline` 全仓 0 命中） |
| 制品通道 | `app/src/tasks/evolution/sopDistill.ts`（确定性蒸馏）→ `SopDraftStore`（`sop_pending/approved/rejected`）→ `/sop approve` → 写 SKILL.md | 已完成 PDCA 计划 | 人工批准后才生效 | 只覆盖 **SOP** 一种制品；拒绝率有统计但**无回流**到蒸馏策略 |
| 知识反哺 | `app/src/knowledge/QueryFeedbackPipeline.ts`（高频话题 → LLM 生成 wiki 页） | 无 | 无 | **零实例化**（`grep 'new QueryFeedbackPipeline'` 全仓 0 命中）⇒ 死代码，不构成闭环 |
| 离线进化 | `packages/dream`（五阶段周期：收集/分析/生成/写回记忆与 SOUL） | 定时/空闲 | 记忆与人格文件 | 与 `turn/quality` 的**分数维度**只在汇总层耦合，不产生可验证制品 |

**结论**：三段能力都在，但中间缺两件东西 ——
1. **归因层**：把"这一轮/这一簇低分"翻译成"该改什么"（SOP？提示片段？评测用例？）
2. **候选台账**：承载"待改进项"的生命周期（发现 → 归因 → 制品 → 验证 → 采纳/拒绝 → 拒绝率回流）

---

## 2. 目标 / 非目标

**目标（可验证）**
- **G1 信号可达**：任意一次低分事件可在**一次命令**内定位到具体会话/轮次/证据（不改事件契约，只加读取面）。
- **G2 归因可解释**：每个候选带**归因证据**（命中的信号分量 + 相关工具名/错误码），不接受"模型说它不好"当唯一依据。
- **G3 制品可验证**：进入语料的候选必须是**可复跑**的（`learning-case-*` L1 任务）；新增任务须在
  `baseline.json` 登记后才能通过 `--gate`（未登记 ⇒ 门禁阻断）。批准与 `--gate` 的先后由人工掌握（§5-M3）。
- **G4 上线受控**：任何改变模型行为的制品必须**人工批准**；带 `expiresAt` 与一键回滚。
- **G5 闭环可度量**：拒绝率、采纳率、回归拦截数三者可查（沿用 `SopDraftStore.computeSopDraftStats` 的口径：未决不计入分母）。
- **G6 主链零影响**：不增每轮 LLM 调用、不增 TTFB（沿用 U4 的"空闲期异步"裁定）。

**非目标（明确不做）**
- **N1**：不做"无人工门控的自我修改"（自动改提示词/自动装技能）—— 越权风险 > 收益。
- **N2**：不做在线训练/微调（本仓无训练面；数据飞轮只到"语料 + 评测"为止）。
- **N3**：不引入第二套评分框架（复用 `turnQuality` 与 `VerifierAgent`，CS01）。
- **N4**：不新造调度器（复用 `IdleScaleMonitor.onIdle` 与既有 cron）。
- **N5**：不做 UI（先命令 + 报告；有真实诉求再谈面板）。
- **N6**：不把 `QueryFeedbackPipeline` 复活 —— 它的产物是"知识页"，与"改进制品"不同域；本 spec 只把它作为**反例**记录（死代码来源），清理另案。

---

## 3. 设计：六段闭环

```
 S1 采集(已有)      S2 归因(新)        S3 制品化(新)      S4 离线验证(已有+新)   S5 受控上线(已有范式)   S6 度量(新)
 turn/quality ──▶ badcaseAttribution ──▶ LearningCandidate ──▶ evals --gate ──▶ /learn review ──▶ LoopStats
      ▲                 │                     (sop|eval_case|prompt_snippet)        │
      └────────── 拒绝率/采纳率回流到归因阈值 ◀──────────────────────────────────────┘
```

### S1 采集（零改动）
保持 `turn/quality` 为唯一在线质量写入点（`turnQualityEvaluator.ts`，装配于 `ChatOrchestrator` 的 onIdle 缝）。新增只做**读取**：按 `EventLogQuery` 的 `types: ['turn/quality']` + `fromSeq` 水位拉取，不新增事件类型（避免动三处强制登记）。

### S2 归因（已落地 M1，纯函数）
- 位置：`app/src/tasks/evolution/badcaseAttribution.ts`（与 `sopDistill` 同域，app 层）
- 输入：`turn/quality` 事件载荷 + 该轮工具观测（`collectTurnToolObservations` 按 `callSeq` 配对
  `assistant/tool_call` 与 `tool/result`，按最近的 `turn/start` 归属轮次）
- 输出：`{ category, confidence, evidence[] }`
- **M1 实际落地 5 类**：`verifier_reject` → `tool_failure` → `budget_exhausted` → `retry_loop` → `low_value_answer`（兜底）
- `repeated_question` **暂缓**：需要"同题配对"的结构化信号，现有事件只有 `replyToId` / `questionId`，
  按 CS02 不做文案相似度猜测（若要做，先扩事件契约）

### S3 制品化（已落地 M1 台账 + M2 批准链）
- `app/src/tasks/evolution/learningCandidates.ts`：**JSON 文件台账**，与 `SopDraftStore` 同构
  （`~/.pyapp/data/learning-candidates/learning-candidate_<id>.json`，原子写 tmp + rename），
  **不新增数据库表**（R02：不新建第二套存储 —— spec 初稿写的 DB 表已按此订正）
- id = `sha256(sessionId#turnNumber#category)` 前 12 位 ⇒ 同轮同类只会有一条（重复扫描幂等）
- 状态（M2 四态）：`lc_pending` → `lc_verified`（**结构化校验**：id 可复算 / 分数 0..1 / 证据非空，
  不跑模型、不跑 evals）→ `lc_approved`（写 `expiresAt` = now + 30 天，并追加语料种子行）；
  `revoke` 走 `lc_approved → lc_rejected`（种子行写 `revokedAt`，**不删行**）
- 语料种子：同目录 `approved-cases.jsonl`，一行一条（`id/sessionId/turnNumber/category/score/evidence/input/expectation/approvedAt`）；
  **`expectation` 恒为 `null`** —— 期望答案必须人工补，本阶段不生成答案（CS04）
- 轮次 ↔ 用户输入：`collectTurnUserInputs`（`turn/start.userMessageSeq` 精确匹配，缺省取该 `turn/start`
  之前最近一条 `user/message`），取不到就不写 `input`（不伪造）
- 统计（M2）：`LearningCandidateStats { total, pending, verified, approved, rejected, rejectedShare }`
  （`rejectedShare = rejected / total`；无候选时为 `null`，不伪造 0%）

### S4 离线验证（复用 `--gate`；M3 已落地物料化 + 卡口）
- **种子 → 语料（手工两步）**：
  1. 人工给 `approved-cases.jsonl` 的 `expectation` 补**可逐字比对的判定片段**（不是整段自然语言期望）；
  2. 执行 `bun run gen:learning-eval-cases -- --write`（在 `app/` 下；默认只预览）⇒ 生成
     `packages/evals/src/evals/tasks/learning-cases.json`（**入库前人工脱敏**）。
- **题集**：`tasks/learning-cases.ts` 在导入时读取该 JSON，按种子生成 `learning-case-<seedId>` 任务；
  判据为 L1「回答包含期望片段」（空白归一后逐字比对），**不做语义相似度/LLM 判分**（与 `smoke.ts` 同口径）。
- **卡口（复用既有 `checkGate`，不新造）**：新增任务在 `baseline.json` 中**未登记** ⇒ `--gate` 直接失败
  （「基线中未登记该任务」）⇒ 必须跑一次记录 `pass^1` 后再登记基线，这是人的第二道门。
- **跳过规则**（不编造判据）：已撤销 / `expectation` 为空 / `input` 为空 ⇒ 不成题，并按原因计数上报。
- `sop`：**M7 已落地** —— `/sop observe <id> [天数]` 用会话事件 join 判定「执行 ≥N 次且未伴随低分」；
  口径与数据源取证见 [`sop-observation-metrics.md`](./sop-observation-metrics.md)。
- `prompt_snippet`：本阶段**不进入验证**（无注入面），只入库待议。

### S5 受控上线（人工门控 + 可回滚）
- **M1 已落地**：`/learn list` · `show <id>` · `scan [会话数]` · `reject <id> [原因]` · `stats`
- **M2 已落地**：`verify <id>`（结构化校验）· `approve <id>`（写 `expiresAt` = now + 30 天 + 追加种子行）·
  `revoke <id> <原因>`（种子行标记 `revokedAt`，不删行）· `export`（展示种子路径与条数）
- **M4 已落地（到期收口）**：`expiresAt` 到点未复核的批准 ⇒ `lc_rejected` + 备注
  `已过期（批准后未复核）` + 种子写 `revokedAt`；由 `list` / `stats` / `export` **惰性**触发
  （不起定时器）。已入语料的题**不会**因过期消失（过期只决定"能否进入语料"）。
- **反向操作句柄**：撤销（人工，必填原因）与过期（客观）共用同一收口路径；SKILL.md 卸载不在本闭环内

### S6 度量（拒绝占比回流）
- **M1 + M2 已落地**：`LearningCandidateStats { total, pending, verified, approved, rejected, rejectedShare }`
  （四态计数；`rejectedShare = rejected / total`；无候选 ⇒ `null`）。
- **M5 已落地（`gateBlocked` = 登记缺口）**：`checkCaseBaseline(records, baselineTaskIds)` 纯读侧比对
  「应入语料的题」与 `baseline.json` 的 `tasks` 键 ⇒ 未登记的题由脚本逐条列出（它们会被 `--gate` 阻断）。
- **M6 已落地（真实回归拦截数）**：`auditLearningCaseGate(reportTasks, baselineTasks)` 读最近一次跑批报告，
  按**与 `--gate` 同一份判据**（`checkTaskAgainstBaseline`）给出 通过 / 回归（`passK` / `pass1`）/ 未登记；
  命令 `bun run report:learning-regressions`（有回归 ⇒ 退出码 1）。详见 `learning-gate-regression-audit.md`。
- **M8 已落地（`rejectedShare` 阈值回流）**：按类别统计**已决**候选（`lc_approved` + `lc_rejected`），
  样本 ≥ 10 且拒绝占比 ≥ 80% ⇒ 在 `/learn scan` 时把该类别低分阈值**下调 0.1**（下限 0.1，
  即更严、产出的候选更少）；扫描输出逐条点名收紧的类别，`/learn stats` 展示各类别占比。
  **纯派生、不落盘**（不新增策略文件）；未收紧的类别与旧口径逐字一致。

---

## 4. 数据模型（M1 + M2 已落地：JSON 文件，非 DB 表）

单条候选一个文件：`learning-candidate_<id>.json`（原子写 tmp + rename，与 `SopDraftStore` 同构）。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | `sha256(sessionId#turnNumber#category)` 前 12 位（确定性 ⇒ 幂等） |
| `sessionId` | string | 证据定位（G1） |
| `turnNumber` | number | 轮次 |
| `category` | string | S2 归因类别（5 类） |
| `score` | number | 该轮合成分（来源 `turn/quality`） |
| `evidence` | string[] | 归因证据（信号分量、工具名、错误码） |
| `summary` | string | 单行展示文案（只拼结构化字段） |
| `input?` | string | 该轮用户输入（`turn/start` 与 `user/message` 结构化配对；取不到则缺省） |
| `status` | string | `lc_pending` / `lc_verified` / `lc_approved` / `lc_rejected`（M2 四态） |
| `createdAt` / `decidedAt?` / `note?` | number / number / string | 生命周期与拒绝/撤销原因 |
| `gate?` | `{checkedAt, kind:'structural'}` | 结构化校验记录（`verified` 起有值） |
| `expiresAt?` | number | 批准有效期（`approved` 起有值，默认 now + 30 天） |

批准产物：`approved-cases.jsonl`（一行一条；记录 `expiresAt`；M2 写入时 `expectation` 为 `null`，
人工补齐后由 `gen:learning-eval-cases` 物料化为 `learning-cases.json`；撤销 / 过期只写 `revokedAt`，不删行）。

> 取词带 `lc_` 前缀的理由与 `sop_` 相同：`pending` / `rejected` 是跨域通用词，直接登记会污染状态词汇表
> （同 `SopDraftStore` 头部注释的既有裁定；`lint:state-ratchet` 会拦裸字面量）。

---

## 5. 分步落地

### 5-M1 最小可行第一步（已落地）

| 件 | 落点 |
|---|---|
| S2 归因（纯函数，零 LLM） | `app/src/tasks/evolution/badcaseAttribution.ts`（5 类 + `collectTurnToolObservations`） |
| S1+S3 采集→候选（纯函数） | `app/src/tasks/evolution/learningScan.ts`（低分阈值由调用方注入，单源 `SUSPICIOUS_SCORE_THRESHOLD`） |
| S3 台账 | `app/src/tasks/evolution/learningCandidates.ts`（JSON 文件 + `lc_*` 两态 + 统计） |
| 命令 | `app/src/commands/builtin/learn/Learn.ts`（`list/show/scan/reject/stats`；**无 approve**） |
| 接线 | `command-registry.ts` / `builtin/index.ts` / `commands/index.ts` / `commandGroups.ts` / `CommandLoader.ts` / `tasks/index.ts` |

**M1 验收（实测）**：新增 14 条单测全绿（归因 5 类 + 事件配对 2 + 台账 3 + 扫描 2 + 命令 2）；
全量 `bun test` **11,991 pass / 44 skip / 0 fail**；`typecheck` 0 错；`lint` / `lint:arch` / `lint:infra` /
`lint:consts` / `lint:state-ratchet` / `lint:fn-size` / `lint:size` / `lint:unref` / `lint:entrypoints` /
`lint:command-coverage` / `lint:doc-code` 全绿。**零行为变更**：不改 `turn/quality` 写入路径、不写语料、不装技能。

### 5-M2 批准链与语料种子（已落地）

| 件 | 落点 |
|---|---|
| 状态扩四态 | `learningCandidates.ts`：`lc_verified` / `lc_approved` + `gate` / `expiresAt` |
| 结构化校验 | `isStructurallyVerifiable()`（id 可复算 / 分数 0..1 / 证据非空；**零 LLM、零 evals**） |
| 批准 → 种子 | `approve()`：先写 `approved-cases.jsonl` 再翻状态（种子失败则不批准）；`expectation: null` |
| 撤销 | `revoke()`：`lc_approved → lc_rejected`，种子行写 `revokedAt`（不删行） |
| 轮次 ↔ 输入 | `collectTurnUserInputs()`（`userMessageSeq` 精确匹配，缺省取该 `turn/start` 之前最近一条） |
| 命令 | `verify / approve / revoke <id> <原因> / export`；`scan` 读取类型加 `user/message` |

**M2 时为零行为变更**：不写提示词、不装技能、**不改 `packages/evals` 语料**；种子只是待人工补期望的中间产物。
（M3 起由**人工**脚本把补齐期望的种子落为语料，见下节。）

### 5-M3 种子物料化与 `--gate` 卡口（已落地）

| 件 | 落点 |
|---|---|
| 种子读取/过滤（纯函数） | `packages/evals/src/evals/tasks/learning-cases.ts` 的 `selectLearningCaseRecords()`（撤销 / 无期望 / 无输入 三类跳过；id 升序） |
| 种子 → 题集 | `buildLearningCaseTasks()` / `toLearningCaseTask()`：`learning-case-<seedId>`，L1「回答包含期望片段」（空白归一） |
| 语料文件 | `tasks/learning-cases.json`（**当前为空数组** ⇒ 对既有跑批零影响；由脚本生成，不入库前须人工脱敏） |
| 转换脚本 | `app/scripts/gen-learning-eval-cases.ts`（`bun run gen:learning-eval-cases`；**默认只预览**，`--write` 才落盘；坏行计数上报） |
| 题集接线 | `tasks/index.ts` 追加 `...learningCaseTasks` |
| 卡口 | **复用** `checkGate`：未在 `baseline.json` 登记的新任务 ⇒ `--gate` 直接失败；登记需人工跑一次记录 `pass^1` |

**为什么判据只做逐字比对**：`EvalTask` 的 L1/L2 是确定性断言，L3（LLM-as-judge）在本仓**未实现**
（`types.ts` 头部口径）。用语义相似度当判据等于把"模型说它好"当唯一依据（违反 G2）⇒ 只接受
**可逐字比对的片段**；语义类语料需先另立 L3 spec。

**M3 验收（实测）**：新增 10 条单测全绿（跳过规则 3 + 断言口径 3 + 加载/构建 4）；
脚本以 fixture 实测：3 条输入（含 1 坏行）⇒ 可成题 1 / 跳过 2（撤销 1、无期望 1），`--write` 产物与预期一致。

### 5-M4 批准到期收口（已落地）

| 件 | 落点 |
|---|---|
| 到期判定（纯函数） | `findExpiredApproved(items, now)`：只认同为 `approved` 且有 `expiresAt` 且 `<= now`（无 `expiresAt` 的历史候选视为无期限） |
| 收口 | `LearningCandidateStore.expireOverdue(now)`：`lc_approved → lc_rejected` + 备注 `已过期（批准后未复核）` + 种子写 `revokedAt`（幂等） |
| 共性重构 | `revoke` 与 `expireOverdue` 共用 `closeApproved()`（先标种子、再落候选状态） |
| 触发 | `/learn list` · `stats` · `export` 读路径惰性执行，并在输出里报告本次过期条数（**不新增定时器**） |
| 种子 | `approved-cases.jsonl` 起记录 `expiresAt`；`selectLearningCaseRecords(records, now)` 以 `expired` 原因跳过过期种子 |

**边界**：过期是"未复核"的客观结果，备注固定、不接受自定义原因（人工撤销才是 `已撤销（原因）`）；
已进入 `learning-cases.json` 的题不因过期被删（回归题按基线继续跑）。

**M4 验收（实测）**：新增 4 条单测全绿（台账收口与边界 1 + 命令惰性收口 1 + 语料过期跳过 2）。

### 5-M5 `gateBlocked` 登记缺口（已落地，纯读侧）

| 件 | 落点 |
|---|---|
| 比对（纯函数） | `checkCaseBaseline(records, registeredTaskIds, now)` ⇒ `{ total, registered, blocked[] }`（分母复用同一套跳过规则） |
| 数据源 | `baseline.json` 的 `tasks` 键（评测任务 id）；`--baseline=<path>` 可覆盖（测试/临时基线） |
| 呈现 | `gen:learning-eval-cases` 的预览与落盘都打印「应入语料 / 已登记 / 未登记」并逐条列出未登记的 `learning-case-<id>` |
| 不改基线 | 脚本只读基线；登记仍是人工（跑一次记录 `pass^1` 后写 `baseline.json`） |

**口径边界（重要）**：`gateBlocked` 统计的是**登记缺口**（未登记 ⇒ 门禁必然阻断），**不是**回归拦截数。
真实回归（`pass^1 < minPass1` / `pass^k` 未达标）只能从 `evals` 跑批报告读取，回写台账仍在 §5-M6。

**M5 验收（实测）**：新增 4 条单测全绿（全登记 / 部分未登记 / 过滤后分母 / 空语料）；
脚本以 fixture 实测（2 条种子 + 只登记 1 条）⇒ 正确列出 `learning-case-bb22` 未登记。

### 5-M6 真实回归审计（已落地，独立 spec）

详见 [`learning-gate-regression-audit.md`](./learning-gate-regression-audit.md)。要点：

| 件 | 落点 |
|---|---|
| 判据抽取（**唯一实现**） | `scoring.ts` 的 `checkTaskAgainstBaseline()`：`checkGate` 改为调用它，输出逐字不变 |
| 审计（纯函数） | `tasks/learning-cases.ts` 的 `auditLearningCaseGate(reportTasks, baselineTasks)` ⇒ `{ total, passed, failures[{id, kind, message}] }` |
| 命令 | `bun run report:learning-regressions`（默认取 `dev_docs/evals` 最新报告；`--report=` / `--baseline=` 可指定） |
| 退出码 | 0 无回归（含"报告未包含学习语料"）/ 1 有回归或未登记 / 2 输入缺失或不可解析 |
| 边界 | 只读、不跑模型、不改基线、不写台账；非 `learning-case-*` 任务不参与 |

**M6 验收（实测）**：新增 7 条单测全绿（判据 3 + 审计 4）；脚本以 fixture 实测
（3 条语料：1 通过 / 1 双项回归 / 1 未登记，另有 1 条非语料任务）⇒ 只报 3 条语料违规、退出码 1；
"报告未包含学习语料"路径 ⇒ 明确提示且退出码 0。

### 5-M7 SOP 观察期度量（已落地，独立 spec）

详见 [`sop-observation-metrics.md`](./sop-observation-metrics.md)。要点：

| 件 | 落点 |
|---|---|
| 纯函数 | `app/src/tasks/evolution/sopObservation.ts`：`collectSopSkillObservations` / `summarizeSopObservations` / `judgeSopObservation` |
| 数据源 | 会话事件 `assistant/tool_call`（`skill` + `op=run` + `args.name`）与 `turn/quality`（按轮 join）；**不用** `skills-usage.json`（只有聚合计数，无逐次时间/会话关联） |
| 命令 | `/sop observe <id> [天数]`（默认 7 天、N=5）；未批准草案拒绝观测；只读 |
| 三态 | 有低分 ⇒ `flagged`（优先）；次数 `< N` ⇒ `insufficient`；否则 `supported` |
| 单源 | 低分阈值复用 `SUSPICIOUS_SCORE_THRESHOLD`；技能名由 `sopSkillName()` 决定 |

**M7 验收（实测）**：新增 12 条单测全绿（采集 4：run 口径 / 窗口 / 无 turn/start / 重评覆盖；
汇总与判定 4；命令 4：未批准 / supported / flagged / 非法天数）。

### 5-M8 拒绝占比阈值回流（已落地）

| 件 | 落点 |
|---|---|
| 分组（纯函数） | `computeCategoryDecisions(items)`：只算已决（approved + rejected），按拒绝占比降序 |
| 收紧建议（纯函数） | `suggestCategoryCutoffs(items, {baseCutoff})`：样本 ≥ `LEARNING_POLICY_MIN_DECIDED`(10) 且占比 ≥ `LEARNING_POLICY_REJECTION_SHARE`(0.8) ⇒ `base - 0.1`，下限 `LEARNING_POLICY_CUTOFF_FLOOR`(0.1) |
| 语义 | 产候选条件是「分数 < 阈值」⇒ **阈值越低越严**；"收紧"= 下调，不是上调 |
| 应用 | `/learn scan` 把 `cutoffs` 传给 `buildLearningCandidates`，并在输出点名收紧的类别；`/learn stats` 展示各类别占比 |
| 边界 | 纯派生（每次扫描从台账重算）；不写策略文件、不改台账；未达门槛的类别行为不变 |

**M8 验收（实测）**：新增 4 条单测全绿（只算已决 / 样本不足不收紧 + 下调与下限 /
扫描侧按类别生效且其它类别不受影响 / 命令输出点名与非成题）。

### 5-M9 待裁定项（注入面已落地 S1；其余未开工）

| 项 | 状态 |
|---|---|
| `prompt_snippet` 注入面 | 🟠 **S1 已落地**（[`prompt-snippet-injection-redline.md`](./prompt-snippet-injection-redline.md)：台账 + 纯函数，**未接线**）；S2~S4 未开工 |
| `repeated_question` 归因 | ⏸ 需扩事件契约（会动事件三处登记），未开 spec |

> 注入面只落地 S1（台账 + 纯函数、**未接线**）⇒ 运行时行为零变化；S2~S4 与 `repeated_question`
> 都需再裁定后才继续。

---

## 6. 验收与门禁（M1 ~ M8）

| 项 | 判据 | 状态 |
|---|---|---|
| 归因可解释 | 每条候选 `evidence` 非空；5 类各 1 例 | ✅ |
| 状态词汇合规 | 只用 `lc_*` 前缀；命令层不写 `'error'`/`'text'` 等词汇表裸字面量 | ✅ |
| 数据落盘 | 写入后可重读；`save` 幂等且不改写已决状态 | ✅ |
| 批准前置 | 未 `verified` 的 `approve` 返回 `null` 且不写种子（命令层明确报错） | ✅ |
| 种子可回溯 | 种子行 `expectation` 由人工补、含该轮 `input`（若可取）；撤销只写 `revokedAt` 不删行 | ✅ |
| 可回滚 | `revoke` 后候选转 `lc_rejected`；`/learn export` 显示有效 / 已撤销 / 可成题条数 | ✅ |
| 到期收口 | `expiresAt <= now` 的批准 ⇒ `lc_rejected` + 固定备注 + 种子 `revokedAt`；差 1ms 不触发；重复执行幂等 | ✅ |
| 过期不入语料 | `selectLearningCaseRecords(records, now)` 以 `expired` 跳过；已入库题不受影响 | ✅ |
| 语料可复现 | 同一 JSONL 两次转换产物逐字一致（id 升序 + 固定字段 + 原子写） | ✅ |
| 不编造判据 | 无 `expectation` / 已撤销 / 无 `input` ⇒ 不成题，按原因计数上报 | ✅ |
| 卡口 fail-closed | 未登记基线的新任务 ⇒ `--gate` 失败；语料文件存在但非数组 ⇒ 抛出 | ✅ |
| 登记缺口可查 | `checkCaseBaseline` 与 `baseline.json` 的 `tasks` 比对，逐条列出未登记任务；分母与语料同一套跳过规则 | ✅ |
| 不改基线 | 脚本只读 `baseline.json`（`--baseline=` 可覆盖），登记动作始终人工 | ✅ |
| 真实回归可查 | `auditLearningCaseGate` 与 `checkGate` 共用判据；`report:learning-regressions` 有回归 ⇒ 退出码 1 | ✅ |
| 全局门禁不变 | `checkTaskAgainstBaseline` 抽取后 `checkGate` 输出逐字不变（既有门禁用例全绿） | ✅ |
| SOP 观察期可查 | `/sop observe` 只算 `op=run`、按轮 join `turn/quality`；缺质量事件如实留白；未批准拒绝观测 | ✅ |
| 阈值回流可查 | 样本 ≥ 10 且拒绝占比 ≥ 80% ⇒ 该类别阈值下调 0.1（下限 0.1）；扫描输出点名；其它类别不变 | ✅ |
| 零行为变更 | 无提示词/技能写入；语料初始为空（0 条）⇒ 既有跑批逐字不变；`--gate` 由人工执行 | ✅ |
| 变异验证 | 反转归因判定 ⇒ 相关单测转红（例如把 `verdict=REJECT` 分支去掉，`verifier_reject` 用例必红）；去掉 `verified` 前置 ⇒ 批准用例必红；把跳过规则去掉一条 ⇒ 语料用例必红 | ✅（人工核对口径） |

---

## 7. 风险与缓解

| 风险 | 表现 | 缓解 |
|---|---|---|
| 候选噪声淹没评审 | 每个会话都产候选 | 阈值 + 去重（同 category 同工具 24h 合并）+ 拒绝率回流自动收紧 |
| 评审疲劳 | 人不再看队列 | M1 只做只读 + 拒绝；`/learn list` 默认按分数升序、限 10 条 |
| 过度拟合线上样本 | 语料只覆盖近期 badcase | 新语料必须与既有 `l0..smoke` 语料同跑 `--gate`，回归即阻断 |
| 成本失控 | LLM 复核被滥用 | 复核只在"类别不明 + 极低分"触发，且沿用 `MAX_REVIEWS_PER_IDLE` 的硬上限范式 |
| 与 dream/U4 职责重叠 | 两处都在"利用质量信号" | 明确分工：U4=**打分**，dream=**离线记忆/人格**，本 spec=**制品与验证**；三者只共享 `turn/quality` 事件 |

---

## 8. 采用的默认裁定（用户多次回复均未逐条选择，按最保守口径执行）

**M1**
1. **M1 不写 `eval_case` 语料文件** —— 只入库候选，不碰 `packages/evals` 语料（零行为变更优先）。
2. **`prompt_snippet` 整类移出 M1** —— 无注入面，留到后续另立红线 spec。
3. **观察期 7 天 / `expiresAt` 30 天** —— 保留为后续默认值（M1 未启用到期逻辑）。

**M2（「执行吧」同口径）**
4. **候选取库不自动落 `packages/evals` 语料** —— `approve` 只追加本地 `approved-cases.jsonl` **种子**，
   `expectation: null` 由人工补；合入与 `--gate` 由人工执行（避免本批引入模型依赖与长耗时门禁）。
5. **批准前置 = 结构化校验，不是 `--gate`** —— `verify` 只查 id 可复算 / 分数 0..1 / 证据非空；
   `--gate` 卡口与"批准链接线顺序"留到 M3，在 spec 明写而非代码里留半成品。
6. **`revoke` 必须写原因**，且种子行只标记 `revokedAt`、**不删行**（保留审计与可回滚）。
7. **不扩事件契约** —— `repeated_question` 仍暂缓（`input` 配对复用既有 `turn/start` / `user/message` 字段）。

**M3（本轮「执行吧」同口径）**
8. **判据只做逐字比对** —— `learning-case-*` 用 L1「回答包含期望片段」（空白归一），不引入 L3 LLM 判分
   （本仓 L3 未实现；语义判据需另立 spec，避免把"模型说它好"当唯一依据）。
9. **语料初始为空数组入库** —— `learning-cases.json` 落 `[]`：既把读取/接线/卡口打通，又保证既有跑批**零变化**；
   真实种子由人工 `--write` 落盘（默认只预览，防误提交隐私数据）。
10. **不自动登记基线** —— 复用 `checkGate` 的「基线中未登记该任务」阻断；登记阈值由人工跑一次后录入。

**M4（本轮「执行吧」同口径）**
11. **到期收口不做定时器** —— 由 `list` / `stats` / `export` 读路径惰性执行（`expireOverdue`），
    避免为"到期"新增调度缝；过期备注固定为 `已过期（批准后未复核）`，与人工撤销（带原因）区分。
12. **过期只拦"进入语料"，不删已入库题** —— 回归题一旦入库就按基线继续跑；撤销/过期只改台账与种子标记。

**M5（本轮「执行吧」同口径）**
13. **`gateBlocked` 只算"登记缺口"** —— 纯读侧比对语料与 `baseline.json` 的 `tasks` 键（不跑模型、
    不改基线）；真实回归拦截数需读跑批报告，留给 §5-M6，避免用近似口径冒充"回归数"。

**M6（「先开 spec 再动手」同口径）**
14. **回归口径只认 `--gate` 的判据** —— 抽出 `checkTaskAgainstBaseline` 供两边共用，不写第二套比较；
    `report:learning-regressions` **只读**跑批报告与基线，**不写台账**（避免第二套存储），
    "可查"= 命令可见 + 非 0 退出码可挂 CI。

**M7（同口径）**
15. **SOP 观察期用会话事件、不用 `skills-usage.json`** —— 后者只有聚合计数（无逐次时间/会话关联），
    无法按观察窗切片；改用 `assistant/tool_call` + `turn/quality` 按轮 join（只读、零新埋点）。
16. **缺质量事件的轮次如实留白**（`unscoredTurns`），不计通过也不计低分；判定顺序低分优先于次数不足。

**M8（同口径）**
17. **阈值回流是纯派生、不落盘** —— 每次扫描从台账重算；"收紧"= 低分阈值**下调**（越小越严），
    并设下限 0.1，避免把候选产出压到 0；扫描输出必须点名被收紧的类别（不静默改行为）。

---

## 9. 与既有能力的关系（不重复造轮子）

| 既有 | 本 spec 的用法 |
|---|---|
| `turnQualityEvaluator`（U4） | **只读**其 `turn/quality` 事件，不改写入路径、不改权重 |
| `VerifierAgent` | 仅作为"类别不明"时的复核器（沿用 `TaskModelConfig.verifier` 分工） |
| `evals --gate` / `baseline.json` | 语料合入的唯一卡口 |
| `SopDraftStore` | `sop` 类候选的既有台账（不迁移、不并行维护） |
| `IdleScaleMonitor.onIdle` | 唯一的触发缝（不新造调度） |
| `EventLogQuery` + `fromSeq` 水位 | 采集不重评、不漏评（同 U4 手法） |
