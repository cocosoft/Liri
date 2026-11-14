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

### S2 归因（已落地 M1，纯函数）
- 位置：`app/src/tasks/evolution/badcaseAttribution.ts`（与 `sopDistill` 同域，app 层）
- 输入：`turn/quality` 事件载荷 + 该轮工具观测（`collectTurnToolObservations` 按 `callSeq` 配对
  `assistant/tool_call` 与 `tool/result`，按最近的 `turn/start` 归属轮次）
- 输出：`{ category, confidence, evidence[] }`
- **M1 实际落地 5 类**：`verifier_reject` → `tool_failure` → `budget_exhausted` → `retry_loop` → `low_value_answer`（兜底）
- `repeated_question` **暂缓**：需要"同题配对"的结构化信号，现有事件只有 `replyToId` / `questionId`，
  按 CS02 不做文案相似度猜测（若要做，先扩事件契约）

### S3 制品化（已落地 M1，台账）
- `app/src/tasks/evolution/learningCandidates.ts`：**JSON 文件台账**，与 `SopDraftStore` 同构
  （`~/.pyapp/data/learning-candidates/learning-candidate_<id>.json`，原子写 tmp + rename），
  **不新增数据库表**（R02：不新建第二套存储 —— spec 初稿写的 DB 表已按此订正）
- id = `sha256(sessionId#turnNumber#category)` 前 12 位 ⇒ 同轮同类只会有一条（重复扫描幂等）
- 状态：`lc_pending` → `lc_rejected`（**M1 只有这两态**；`verified` / `approved` 属 M2，
  不预留空分支，避免"看起来接了实际不可用"）
- 统计：`rejectedShare = rejected / total`（M1 无 `approved`，沿用 SOP 的"拒绝率"会恒为 1 ⇒
  那是指标造假；无候选时为 `null`，不伪造 0%）

### S4 离线验证（复用 `--gate`）
- `eval_case`：新增语料必须能在**离线模式**复跑；合入前跑 `evals --gate`，对 `baseline.json` 回归则**阻断**（复用现有机制，不新造）。
- `sop`：以"批准后 SKILL.md 是否被真实调用 ≥N 次且未伴随低分"作为观察期判据（观察窗默认 7 天，可配）。
- `prompt_snippet`：本阶段**不进入验证**（无注入面），只入库待议。

### S5 受控上线（人工门控 + 可回滚）
- **M1 已落地**：`/learn list` · `show <id>` · `scan [会话数]` · `reject <id> [原因]` · `stats`
  —— **没有 `approve`**（命令层显式拒绝并说明"批准链在 M2 随 `evals --gate` 落地"）。
- M2 计划：批准时记录 `expiresAt`（默认 30 天）与反向操作句柄（删除生成语料 / 卸载 SKILL.md）；
  到期未复核自动转 `lc_rejected` 并提示。

### S6 度量（拒绝占比回流）
- **M1 已落地**：`LearningCandidateStats { total, pending, rejected, rejectedShare }`
  （`rejectedShare = rejected / total`；无候选 ⇒ `null`）。
- M2 计划：`gateBlocked`（被 `--gate` 拦下的候选数）；`rejectedShare` 连续 N 次高于阈值 ⇒
  下调该 `category` 的候选产出（阈值上调），避免噪声候选淹没评审。

---

## 4. 数据模型（M1 已落地：JSON 文件，非 DB 表）

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
| `status` | string | `lc_pending` / `lc_rejected`（M1 两态） |
| `createdAt` / `decidedAt?` / `note?` | number / number / string | 生命周期与拒绝原因 |

> 取词带 `lc_` 前缀的理由与 `sop_` 相同：`pending` / `rejected` 是跨域通用词，直接登记会污染状态词汇表
> （同 `SopDraftStore` 头部注释的既有裁定；`lint:state-ratchet` 会拦裸字面量）。

---

## 5. 最小可行第一步（M1，已落地）

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

**M2 之后**（需再裁定）：`eval_case` 自动生成语料 + `--gate` 卡口；`prompt_snippet` 注入面（另立红线 spec）；
`sop` 观察期自动度量；`repeated_question` 需要事件契约扩展。

---

## 6. 验收与门禁（M1）

| 项 | 判据 | 状态 |
|---|---|---|
| 归因可解释 | 每条候选 `evidence` 非空；5 类各 1 例 | ✅ |
| 状态词汇合规 | 只用 `lc_*` 前缀；命令层不写 `'error'`/`'text'` 等词汇表裸字面量 | ✅ |
| 数据落盘 | 写入后可重读；`save` 幂等且不改写已拒绝状态 | ✅ |
| 零行为变更 | 无 `approve`；不改 `turn/quality` 写入路径；`evals` 语料零改动 | ✅ |
| 变异验证 | 反转归因判定 ⇒ 相关单测转红（例如把 `verdict=REJECT` 分支去掉，`verifier_reject` 用例必红） | ✅（人工核对口径） |

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

## 8. M1 采用的默认裁定（用户回复"创建吧"时未逐条选择，按最保守口径执行）

1. **M1 不写 `eval_case` 语料文件** —— 只入库候选，不碰 `packages/evals` 语料（零行为变更优先）。
2. **`prompt_snippet` 整类移出 M1** —— 无注入面，留到 M2 另立红线 spec。
3. **观察期 7 天 / `expiresAt` 30 天** —— 保留为 M2 默认值（M1 未启用到期逻辑）。

**留给 M2 的三个裁定**：① 候选取库（`eval_case` 是否自动落语料）；② 批准链与 `--gate` 卡口的接线顺序；
③ 是否扩事件契约以支持 `repeated_question`。

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
