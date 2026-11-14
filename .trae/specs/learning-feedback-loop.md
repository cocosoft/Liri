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

- **状态**：📝 **草案（2026-11-15，待评审；本文件不含已落地代码）**
- **来源**：`dev_docs/20261114/今日计划-2026-11-14.md` §4.1 逐项审计 —— 21 模式中 **#9 是唯一"部分"级缺口**（其余三处为有条件实现：#4 自校验档 / #17 ToT / #21 探索）
- **关联 spec**：`online-quality-evaluation.md`（U4 在线打分，已有实现）· `cross-path-evaluation-write-side.md`（三路评价写入面，结论：**互不相通**）
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
- **G3 制品可验证**：只有**经 `evals --gate` 未回归**的候选才允许进入待批准队列；评测用例类候选必须落为**可复跑语料**。
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

### S2 归因（新增，纯函数优先）
- 位置：`app/src/tasks/evolution/badcaseAttribution.ts`（与 `sopDistill` 同域，app 层）
- 输入：一段 `turn/quality` 事件 + 该轮 `assistant/tool_call` 的白名单字段（工具名、结果 ok/err、`metric/timing`）
- 输出：`{ category, confidence, evidence[] }`，`category ∈ { tool_failure, retry_loop, budget_exhausted, verifier_reject, low_value_answer, repeated_question }`
- 规则优先（零 LLM）：与 `deriveTurnSignals` 同源信号；只有"类别不明且分数极低"才允许一次 LLM 复核（走 `TaskModelConfig.verifier` 分工，未配置则跳过）。
- **不接受**：仅凭模型一句"质量差"生成候选（G2）。

### S3 制品化（新增台账，复用既有范式）
- 新增 `LearningCandidateStore`（DB 表 `learning_candidates`；状态机与 `SopDraftStore` 同构：`lc_pending → lc_verified → lc_approved | lc_rejected`）
- 三类制品共用一张表，用 `kind` 区分：
  - `sop`：直接复用 `SopDraftStore`（不迁移，`LearningCandidate` 只存引用 `sopDraftId`）
  - `eval_case`：落 `packages/evals/src/evals/tasks/learning-derived.ts`（生成物，带来源会话 id，便于追溯）
  - `prompt_snippet`：**只产文本候选**，不自动注入；注入需另立红线 spec（U4 §2-N1 同款口径）

### S4 离线验证（复用 `--gate`）
- `eval_case`：新增语料必须能在**离线模式**复跑；合入前跑 `evals --gate`，对 `baseline.json` 回归则**阻断**（复用现有机制，不新造）。
- `sop`：以"批准后 SKILL.md 是否被真实调用 ≥N 次且未伴随低分"作为观察期判据（观察窗默认 7 天，可配）。
- `prompt_snippet`：本阶段**不进入验证**（无注入面），只入库待议。

### S5 受控上线（人工门控 + 可回滚）
- 命令：`/learn list` / `/learn show <id>` / `/learn approve <id>` / `/learn reject <id>`（`sop` 类转发到既有 `/sop`）。
- 回滚：批准时记录 `expiresAt`（默认 30 天）与反向操作句柄（删除生成语料 / 卸载 SKILL.md）；到期未复核自动转 `lc_rejected` 并提示。

### S6 度量（拒绝率回流）
- `LearningLoopStats`：`pending/verified/approved/rejected`、`rejectedRate`（口径同 `computeSopDraftStats`）、`gateBlocked`（被 `--gate` 拦下的候选数）。
- 回流：`rejectedRate` 连续 N 次高于阈值 ⇒ **下调**该 `category` 的候选产出（阈值上调），避免"噪声候选"淹没评审。

---

## 4. 数据模型草案（`learning_candidates`）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PK | 候选 id |
| `kind` | TEXT | `sop` / `eval_case` / `prompt_snippet` |
| `category` | TEXT | S2 归因类别 |
| `status` | TEXT | `lc_pending` / `lc_verified` / `lc_approved` / `lc_rejected` |
| `session_id` / `turn_seq` | TEXT / INTEGER | 证据定位（G1） |
| `evidence` | TEXT(JSON) | 归因证据（信号分量、工具名、错误码） |
| `payload` | TEXT(JSON) | 制品内容或引用（`sopDraftId` / 语料文件名） |
| `gate` | TEXT(JSON) | `evals --gate` 结果快照（通过/回归项） |
| `created_at` / `expires_at` | TEXT | 生命周期 |

> 取词带 `lc_` 前缀的理由与 `sop_` 相同：`pending/approved` 是跨域通用词，直接登记会污染状态词汇表（同 `SopDraftStore` 头部注释的既有裁定）。

---

## 5. 最小可行第一步（M1，单 PR 范围）

**只做"看得见、不改行为"的三件**：
1. `badcaseAttribution`（纯函数 + 单测，规则优先、零 LLM）
2. `LearningCandidateStore`（建表 + CRUD + `LearningLoopStats`，只写 `eval_case` 一类）
3. `/learn list|show|reject`（只读 + 拒绝；**暂不提供 approve** ⇒ 物理上不可能改变模型行为）

**M1 的验收**：给定一段真实 `turn/quality` 事件，能产出候选并在 `/learn list` 看到，且 `reject` 后拒绝率正确变化；`bun test` 新增用例 ≥ 6，`typecheck` / `lint:*` 全绿。

**M2 之后**（需再裁定）：`eval_case` 自动生成语料 + `--gate` 卡口；`prompt_snippet` 注入面（另立红线 spec）；`sop` 观察期自动度量。

---

## 6. 验收与门禁（M1）

| 项 | 判据 |
|---|---|
| 归因可解释 | 每条候选 `evidence` 非空；单测覆盖 6 个 category 各 1 例 |
| 状态词汇合规 | 只用 `lc_*` 前缀（`lint:state-ratchet` 不新增裸字面量） |
| 数据落盘 | 候选写入后重启可读；`stats` 与表一致（拒绝率无已决项时为 `null`，不伪造 0%） |
| 零行为变更 | M1 不提供 `approve`；不改 `turn/quality` 写入路径；`evals` 语料零改动 |
| 变异验证 | 人为把 `category` 判定反转 ⇒ 至少 2 条单测转红（防"测试跟着实现走"） |

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

## 8. 待决问题（需用户裁定）

1. **M1 是否允许写 `eval_case` 语料文件**？若不允许（只入库不落语料），M1 可再瘦一半。
2. **`prompt_snippet` 是否需要**？若近期不做提示注入，可整类从 M1 移除，只留 `sop` + `eval_case`。
3. **观察期长度**（默认 7 天）与 `expiresAt`（默认 30 天）是否合用？

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
