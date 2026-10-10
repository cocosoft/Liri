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

# Spec：在线质量评估器（每轮质量打分 → 梦境/离线取数）

- **状态**：**📝 待实施（本 spec 为 U4 立项产物；尚未动码）**
- **依据**：`dev_docs/任务计划-20261004.md` §19.4-**U4**（P0，需立项）；来源为外部建议 **清单 B-2**
  （"P0 上线在线质量评估器（每轮 TAOR 打分，供梦境进化取数）"）
- **用户裁定（2026-10-06）**：
  1. **评估器形态 = 混合**：启发式为主 + **仅可疑轮**触发 LLM 复核；
  2. **时机 = 空闲期异步**（复用既有 `IdleScaleMonitor.onIdle` 缝）；
  3. **落盘 = 同时登记 session event**（3 处同批；为回放审计与将来回注留路）。
- **⚠️ 前置订正（本 spec 如实更正计划原表述）**：§19.4-U4 原写"打分**须**按「模型可见 ⇔ 已落盘」红线登记事件"，
  这是**过强**的前置 —— 红线的适用条件是"该内容**会进入模型请求**"。本轮按裁定**仍登记事件**（用户选择，
  为可重建/审计留路），但**理由是"可重建性"与"前瞻回注"**，**不是**"已属模型可见输入"。现阶段分数**不注入任何提示词**。
- **关联**：`evals/types.ts`（`BehaviorMetrics` 契约处）· `13-P0-1`（`VerifierAgent` 三态 + `failClosed`）·
  `memory-dedup-blocking-rootfix.md` §D4（同一空闲缝先例）· `memory-conflict-detection.md`（同缝分片让出手法）

---

## 1. 问题与证据（全部回仓取证）

| 项 | 证据 |
|---|---|
| **无质量信号** | [`AgentTelemetry.TurnMetrics`](file:///e:/PY/Documents/CODES/PY_APP/app/src/agent/AgentTelemetry.ts#L11-L26) 字段 = `turnNumber/sessionId/startTime/endTime/durationMs/inputTokens/outputTokens/cacheReadTokens/cacheWriteTokens/toolCalls/toolNames/modelName/status/errorMessage` ⇒ **无任何"质量/分数"字段** |
| **梦境取数没有质量维度** | [`AutoDream.ts:262`](file:///e:/PY/Documents/CODES/PY_APP/app/src/chronos/autoDream/AutoDream.ts#L262) `sessionIds = await listSessionsTouchedSince(lastAt)` ⇒ 只拿到**会话清单**；"哪几轮值得进化"**无信号** |
| **既有评估能力全在离线/内嵌** | ① [`evals/behaviorMetrics.ts:113-122`](file:///e:/PY/Documents/CODES/PY_APP/app/src/evals/behaviorMetrics.ts#L113-L122) `computeBehaviorMetrics(calls, text)` → `{selfVerificationCount, explorationCount, draftingRatio}`（**纯函数**）② [`query/VerifierAgent.ts`](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/VerifierAgent.ts) 三态 `APPROVE/REJECT/ESCALATE` + `failClosed`（13-P0-1）③ `tasks/swarm/AgentSwarm.ts` 三态门禁 —— **均未形成"每轮在线质量分"** |
| **判分模型有既定分工位** | [`modelRouter.ts:197-205`](file:///e:/PY/Documents/CODES/PY_APP/app/src/ai/modelRouter.ts#L197-L205) `TaskModelConfig.verifier?: string`（P3 role 路由：*"verifier = 对抗批评/验证（宜用强档）"*）⇒ **LLM 复核的模型必须取此配置**（满足 `model-usage.md`「不得硬编码、不得擅自变更用户所选模型」） |
| **空闲缝已存在** | [`ChatOrchestrator.ts:446-479`](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/orchestrator/ChatOrchestrator.ts#L446-L479) `_ensureIdleScaleMonitor().onIdle` 已在跑 `cleanupStaleTempFiles()` + `runMaintenancePass()`；`IdleScaleMonitor` 有 `idleFired` 守卫（**每次空闲只触发一次**，无需重入保护） |
| **事件登记为编译期三处强制** | [`knownEventTypes.ts:31-98`](file:///e:/PY/Documents/CODES/PY_APP/app/src/session/types/knownEventTypes.ts#L31-L98) `ALL_SESSION_EVENT_TYPES`（`as const satisfies readonly LiriEventType[]`）+ 文件末**穷尽断言** ⇒ 漏登记即 `TS2322`；载荷由 `LiriEvent<T>.data: LiriEventMap[T]` 强制 |
| **分层** | [`modules-to-layers.json:61`](file:///e:/PY/Documents/CODES/PY_APP/scripts/modules-to-layers.json#L61) `evals = app`、`chat = app` ⇒ 评测域放 `evals/` 与 chat **同层**；接线沿用 onIdle 处既有的**动态 import** 风格（降低耦合，避免同层静态环） |

---

## 2. 目标 / 非目标

**目标（可验证）**
- **G1**：每轮产出 **0..1 的合成分**（含可解释分量），**默认零 LLM 调用**。
- **G2**：**仅可疑轮**触发 LLM 复核（复用既有 `VerifierAgent`），且**有单次空闲上限**（防成本失控）。
- **G3**：分数**落为 session 事件 `turn/quality`**（三处同批登记），可从事件**重建**（红线：可复现）。
- **G4**：**真实消费方**：梦境/离线聚合能按分数取"高价值/低价值轮"（避免"只算不用" ⇒ 不制造第二个 N-79/N-80）。
- **G5**：主链**零改动**（不增 TTFB、不增每轮 LLM 调用）。

**非目标（明确不做）**
- **N1**：**不**把分数注入提示词/上下文（⇒ 现阶段**不属**"模型可见输入"；若将来回注，须按红线走**新增事件+注入登记**）。
- **N2**：**不**新建评分框架/调度器 —— 复用 `computeBehaviorMetrics` + `VerifierAgent` + 既有空闲缝（CS01）。
- **N3**：**不**硬编码判分模型 —— 未配置 `verifier` 分工时**跳过复核**（不擅自选模型）。
- **N4**：**不**做 UI（无需求）；**不**新增环境变量（沿用既有开关位）。
- **N5**：**不**做"每轮同步评"（已裁定为空闲期异步）。
- **N6**：**不**为"可疑轮"做 LLM 评分之外的深度分析（不扩到 ToT/多轮辩论）。

---

## 3. 设计

### D1 合成分（启发式；纯函数，零 LLM）

新增**纯函数** `scoreTurn(input): TurnScore`（落 `evals/online/turnQuality.ts`；与 `evals/types.ts` 同域）：

```ts
export interface TurnQualitySignals {
  status: 'running' | 'completed' | 'error' | 'aborted';
  toolCalls: number;
  durationMs?: number;
  inputTokens: number;
  outputTokens: number;
  /** 可选：同轮验证器结论（若已产生）—— 结果率类信号，与 `behaviorFeedback` 同源 */
  verdict?: { type: 'APPROVE' | 'REJECT' | 'ESCALATE'; confidence: number; checkPassRate?: number };
}

export interface TurnScore {
  score: number;                             // 0..1
  components: Record<string, number>;        // 各分量（可解释）
  evaluatorVersion: string;                  // 口径版本（分数可演进，便于回溯）
}
```

- **⚠️ 契约约束（本轮实测发现，必须遵守）**：**不消费** `BehaviorMetrics` 的三个字段
  （`selfVerificationCount` / `explorationCount` / `draftingRatio`）。理由有二：
  ① 该类型有**显式契约「仅观测、不得作为通过/失败判据」**（`evals/types.ts:218-231` 头注释 +
  `behaviorMetrics.ts:22-27`），并有**反向锁定测试**
  （[`app/tests/evals/behaviorMetrics.test.ts:177-188`](file:///e:/PY/Documents/CODES/PY_APP/app/tests/evals/behaviorMetrics.test.ts#L177-L188)
  「行为指标**不参与** `asExpected` 判定」）；exploration / drafting 的置信区间**跨 0（统计不显著）**。
  ② 同域已有**同一取舍的先例**：[`tasks/behaviorFeedback.ts:11-15`](file:///e:/PY/Documents/CODES/PY_APP/app/src/tasks/behaviorFeedback.ts#L11-L15)
  明写「**本模块不消费那三个字段**……而是回流**任务结果**」。
  ⇒ 本评估器**同样只取"结果/成本"类信号**（完成度 · 验证器结论 · 工具反复度 · 时长/token 软分量）。
- **权重与阈值集中在** `evals/online/weights.ts`（单一常量表，便于单测边界）；**不散落**。
- **分量（初版，务实而非精确）**：
  ① **完成度**（`completed`=1 / `aborted`、`error`=0 / `running` 不评）；
  ② **验证器结论**（`APPROVE` 加分；`REJECT`/`ESCALATE` 显著扣；**无 verdict 记为"未知"不加不减**）；
  ③ **工具反复度**（仅"同轮工具调用**明显过多**"轻扣 —— 防死循环式空转；**过少不扣**，
     避免把"直接回答"误判为低质）；
  ④ **代价软分量**（`durationMs` / `outputTokens` 超软阈 ⇒ 轻扣）。
- **明确不做的分量**：自验证/探索/草稿比（受上述契约约束）、正确性（**无 ground truth，不假装能判**）。
- **纯函数** ⇒ 可单测边界、无 IO、无副作用；**分数是相对分，不是正确率**（`evaluatorVersion` 必带）。

### D2 可疑轮判定（LLM 复核的触发；须"少而准"）

`isSuspicious(signals, score)` —— **任一成立即触发**：
1. `status !== 'completed'`（`error` / `aborted`）；
2. 该轮验证器结论 ∈ `{ REJECT, ESCALATE }`；
3. 启发式分 < `SUSPICIOUS_SCORE_THRESHOLD`；
4. 同会话**连续 N 轮**低分（同一失败模式复现）。

**上限（防成本失控，硬约束）**：单次空闲**最多复核 `MAX_REVIEWS_PER_IDLE` 轮**（取"分数最低优先"），超出者**只落启发式分 + 标注 `reviewSkipped: 'budget'`**。

### D3 LLM 复核（复用 `VerifierAgent`；模型走分工配置）

- **复用** [`VerifierAgent`](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/VerifierAgent.ts)（三态 + `failClosed` + `checkPassRate`），**不新造判分器**（CS01）。
- **模型来源**：`TaskModelConfig.verifier`（经既有 `modelRouter` 解析）；**未配置 ⇒ 跳过复核**，分数只取启发式（`reviewSkipped: 'no-model'`）—— ⚠️ **不得**回退到"随便挑一个模型"。
- **复核输入**（最小必要）：该轮**助手终稿文本**（可截断）+ 工具调用摘要；**不**整库回灌（避免 token 爆炸）。
- **🛠 实施取证（2026-10-06，接线时必须遵守的三点）**：
  1. **每轮新建 `VerifierAgent` 实例**（`{ maxCycles: 1 }`）：`cycleCount` 是**实例态**，`verify()` 在
     `cycleCount >= maxCycles` 时**直接 `ESCALATE`**（[`VerifierAgent.ts:315-327`](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/VerifierAgent.ts#L315-L327)）
     ⇒ 空闲期一张 pass 连评多轮，若复用实例会让**第 2 轮起全部被误判**。有回归测试锁定。
  2. **双指标可"推翻"模型自报 verdict**：响应带 `checks[]` 时，最终 verdict 由
     `checkPassRate` + `confidence` 重算（[`:470-501`](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/VerifierAgent.ts#L470-L501)）；
     实测：模型自报 `REJECT` + checks 全过 ⇒ 最终 `APPROVE`（这正是要复用的既有语义，勿自造）。
  3. **无正文 ⇒ 跳过复核**（返回 `null`，记 `reviewSkipped:'no-model'`）：纯工具轮/被中断轮没有可评文本，
     不得凭信号臆断质量（CS06）。
- 结论落 `TurnScore.review`（含 `type/confidence/checkPassRate/reason`）。

### D4 时机与让出（空闲期异步；不阻塞主链）

- 挂点：既有 `ChatOrchestrator._ensureIdleScaleMonitor().onIdle`（**复用同一缝**，`idleFired` 守卫已保证单次触发）。
- **异步 + 分片让出**：每 N 轮 `await new Promise(setImmediate)`，镜像 `findDuplicatesChunked` / `detectChunked`（**不冻结事件循环**）。
- **游标**：按 `(sessionId, lastEvaluatedTurnNumber)` 记录水位，避免重复评同一轮（复用既有会话事件读取路径）。
- **主链零改动**：`streamMessageFlow` / `TAORLoop` **不调用**本评估器。

### D5 落盘：事件为唯一事实源（**不新增表**）

- **新增事件类型 `turn/quality`**，**三处同批**（编译期强制，缺一即 `TS2322`）：
  > **⚠️ 落点订正（2026-10-06 步骤 1 实测）**：事件名已上收为**双端单一事实源**（D-57，2026-09-30）——
  > `LiriEventType` **由 `LIRI_EVENT_NAMES` 派生**，不再在 `session/types/events.ts` 手写联合；
  > 载荷也已拆到独立文件 `eventPayloads.ts`。故三处实际为：
  1. [`shared/events/eventNames.ts`](file:///e:/PY/Documents/CODES/PY_APP/shared/events/eventNames.ts) → `LIRI_EVENT_NAMES` 新增 `'turn/quality'`（**双端唯一事实源**；`LiriEventType` 自动派生）；
  2. [`session/types/eventPayloads.ts`](file:///e:/PY/Documents/CODES/PY_APP/app/src/session/types/eventPayloads.ts) → `LiriEventMap` 新增载荷：
     ```ts
     'turn/quality': {
       turnNumber: number;
       score: number;                 // 0..1
       evaluatorVersion: string;
       components: Record<string, number>;
       signals: { status: string; toolCalls: number; durationMs?: number; inputTokens: number; outputTokens: number };
       reviewed: boolean;
       reviewSkipped?: 'no-model' | 'budget';
       review?: { verdict: 'APPROVE' | 'REJECT' | 'ESCALATE'; confidence: number; checkPassRate?: number; reason?: string };
     };
     ```
  3. `session/types/knownEventTypes.ts` → `ALL_SESSION_EVENT_TYPES` 新增 `'turn/quality'`（穷尽断言自动守护）。
  4. ⚠️ **`client/src/types/events.ts` 的 `LiriEventMap` 也必须加**（**门禁实测发现**）：载荷是**两端各持一份**
     （[`eventTypeParity.test.ts:10-13`](file:///e:/PY/Documents/CODES/PY_APP/app/tests/chat/eventTypeParity.test.ts#L10-L13)
     明写"载荷形状**仍各端自持**"）⇒ 只改 shared 的**名字**不够，**前端漏加会被该门禁抓出**
     （`前端载荷漏了：turn/quality`）；且其**编译期断言②**要求 app 载荷的**必填字段**在 client 载荷中存在
     ⇒ 两端形状须对齐（本次两端同形）。
  > **⇒ 本次实际改动 4 个文件**（原 spec 写"三处"，其中 ② 的"载荷"实为两端两份）—— 已在 §7 步骤 3 记实。
  > **变异验证（实测）**：临时从 `ALL_SESSION_EVENT_TYPES` 移除 `'turn/quality'` ⇒
  > `tsc` 报 `src/session/types/knownEventTypes.ts(185,7): error TS2322: Type 'true' is not assignable to type 'never'`
  > （穷尽断言生效）⇒ 恢复后全绿。
- **不新增 DB 表**：事件日志即事实源（避免"两套真相"/双写漂移；符合 `event-derivation-read-path-rootfix` 的"事件派生"取向）。聚合/取数**从事件派生**。
- ✅ **事件读取路径 = 已定位（2026-10-06，步骤 1）—— 复用既有 reader，不新建**：
  - **权威 reader**：[`EventLogStorage.read(query?: EventLogQuery)`](file:///e:/PY/Documents/CODES/PY_APP/app/src/session/storage/EventLogStorage.ts#L1153)；查询契约 `EventLogQuery`（`fromSeq` / `toSeq` / **`types` 白名单** / `excludeTypes` / `limit`，默认 1000、上限 10000）⇒ 水位设计可直接落（`fromSeq = 上次已评 seq + 1` + `types: ['turn/end','turn/quality']`）。
  - **水位原语（同文件）**：`getTailSeq()` / `getMaxTurn()` / `readBySeq(seq)`。
  - **获取方式 = 由 chat 侧注入**（**既有架构约定**，非本项发明）：[`CompactionOrchestrator.ts:208`](file:///e:/PY/Documents/CODES/PY_APP/app/src/context/compaction/CompactionOrchestrator.ts#L208) 明写「`EventLogStorage` **由 `chat/` 持有** ⇒ 由 ChatManager 注入回调」；[`RequestSnapshotService.ts:97`](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/services/RequestSnapshotService.ts#L97) / [`requestPrep.ts:46`](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/manager/requestPrep.ts#L46) / [`requestBoundary.ts:53`](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/services/requestBoundary.ts#L53) 三处均为 `getEventLog: (sid) => EventLogStorage` **注入式**，并注明"**用注入而非直接持有**"。⇒ 本评估器**同样接收注入的 getter**，**不自取、不新建 reader**。
  - **读取视图范式**：照 [`SessionSummaryReader`](file:///e:/PY/Documents/CODES/PY_APP/app/src/session/storage/SessionSummaryReader.ts#L22-L32)（同目录、**纯函数解析 + 明确"不新增第二真相源"**）。
  - **per-session 句柄**：[`ChatEventLogStore.getOrCreateEventLog(sessionId)`](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/manager/eventLogStore.ts#L86)（由 chat 侧提供）。

### D6 消费方（避免"只算不用"；G4）

- **梦境**：`AutoDream` 在按会话聚合时，可**按分数取"高价值轮"**（如 `score ≥ 高阈`）优先进入进化素材 —— 作为**消费点 1**（最小接入，不改梦境既有判据，仅**增一路输入**）。
- **离线 evals**：报告可附"在线分 vs 离线判分"的对照（**仅观测**，不改 `asExpected`）。
- **验收必要条件**：**至少 1 个真实消费者**（否则本项判为"未闭环"）。

---

## 4. 不变式（不得改变）

| 项 | 约束 |
|---|---|
| 主链时延 | `streamMessageFlow` / `TAORLoop` **零调用**本评估器 ⇒ TTFB 不变 |
| 模型选择 | 判分模型**只**来自 `TaskModelConfig.verifier`；**未配置即跳过**，不得回退 |
| 事件契约 | 新增 `turn/quality` 必须**三处同批**；`KNOWN_SESSION_EVENT_TYPES` 仍从清单派生（不手工维护第二份） |
| 既有离线评测 | `evals/*` 既有口径与 `asExpected` **逐字不变**（本项**只增**在线分） |
| 分数语义 | `score` 是**启发式相对分**，不是"正确率"；必须带 `evaluatorVersion`（口径可演进） |
| 成本 | 默认零 LLM；复核有**单次空闲上限**；不得因本项引入每轮模型调用 |

---

## 5. 验证计划

| # | 用例 | 判据 |
|---|---|---|
| 1 | `scoreTurn` 纯函数边界 | completed/aborted/error 三态；工具数 0/极少/极多；含/不含 verdict ⇒ **分量与总分单调性**符合权重表 |
| 2 | `isSuspicious` 四条规则 | 逐条单独触发 + 全不触发；**连续低分**用例用状态而非字符串判断（CS02） |
| 3 | 上限约束 | 构造 > `MAX_REVIEWS_PER_IDLE` 个可疑轮 ⇒ **只复核上限条**，其余带 `reviewSkipped: 'budget'` |
| 4 | 未配置 verifier | ⇒ **不调用** LLM，`reviewSkipped: 'no-model'`（用桩断言"零调用"） |
| 5 | 事件三处同批 | 写出的 `turn/quality` 可被 `assertEventReadable` 判**可读**；**变异验证**：从清单移除该项 ⇒ `bun run typecheck` 报 `TS2322` |
| 6 | 水位不重评 | 同一 `(sessionId, turnNumber)` 第二次空闲**不再评** |
| 7 | 分片让出 | 大轮次量下 `setImmediate` 被让出（结构断言/单轮耗时上限） |
| 8 | 消费方 | 梦境取数能按分数筛出"高价值轮"（1 例端到端，可用桩） |

**门禁**：`typecheck` 0 · 改动文件 `eslint` 0 · 全量 `bun test` 0 fail · `lint:arch` 维持基线。
**运行时（可选）**：空闲触发一次，确认 `Event Loop 滞后` 无新增（同 dedup/conflict 判据）。

---

## 6. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 启发式分"看起来精确但无依据" | 明确标注**相对分 + `evaluatorVersion`**；权重集中在单一常量表；**不**对外宣称"质量准确率" |
| LLM 复核成本失控 | 仅可疑轮 + **单次空闲上限** + 默认未配置即跳过 |
| 判分模型被擅自选择 | 硬约束：只读 `TaskModelConfig.verifier`；缺配置即降级为"只启发式"（**不**回退） |
| 变成"只算不用"（同 N-79/N-80 教训） | **G4 硬性要求 ≥1 真实消费方**；未接入则判"未闭环" |
| 分数被误当"模型可见输入" | N1 + 文档三重声明（本 spec / 事件注释 / 计划）；回注须另立批次 |
| 空闲期仍占 CPU | 分片让出（D4）+ 单次轮数上限（D2） |

---

## 7. 任务拆分（实施顺序）

1. ✅ **定位事件读取路径 —— 已完成（2026-10-06）**：权威 reader `EventLogStorage.read(EventLogQuery)` + **chat 侧注入**范式（三处先例）+ `SessionSummaryReader` 读取视图范式；**不新建 reader**（详见 §D5）。
2. ✅ **`evals/online/` —— 已完成（2026-10-06）**：`types.ts`（契约）+ `weights.ts`（权重/阈值单一常量表，含"和必须为 1"的锁定）+ `turnQuality.ts`（`scoreTurn` / `isSuspicious` / `nextLowScoreStreak`，**不消费 `BehaviorMetrics`**）；单测 `app/tests/evals/turnQuality.test.ts` **16 例**（含 §5 用例 1/2 + 权重不变量 + **两条边界反向锁定**）；
3. ✅ **事件登记 —— 已完成（2026-10-06）**：实际改 **4 个文件** —— `shared/events/eventNames.ts`（`LIRI_EVENT_NAMES`）· `app/src/session/types/eventPayloads.ts`（后端载荷）· `client/src/types/events.ts`（**前端载荷，门禁要求两端各持**）· `app/src/session/types/knownEventTypes.ts`（清单）。**验证**：app/client `typecheck` 均 **0** · `eventTypeParity.test.ts` **3 pass / 0 fail** · **变异验证**：移除清单项 ⇒ `TS2322`（穷尽断言生效）；
4. ✅ **`turnQualityEvaluator` —— 已完成（2026-10-06）**：`deriveTurnSignals.ts`（**纯函数**从事件派生每轮信号）+ `turnQualityEvaluator.ts`（水位/去重 → 打分 → 可疑轮复核（**上限 + 最低分优先**）→ 落事件；**分片让出**；单会话错误隔离）；单测 `app/tests/evals/turnQualityEvaluator.test.ts` **14 例**（§5 用例 3/4/6/7 + 错误隔离）。
   - **实施中发现的真问题并已修**：水位只读 `水位+1` 会**漏评**"水位落在轮中"的那一轮 ⇒ 改**回看窗口**（`SIGNAL_SEQ_LOOKBACK=500`）+ **按轮号去重**（`lastTurnNumber`）。
5. ✅ **接线 `ChatOrchestrator.onIdle` —— 已完成（2026-10-06）**：与 memory 维护**并列**新增一路动态 import 调用；**句柄全注入**（新增宿主方法 `readSessionEvents`；写走既有 `appendStreamEvent` + `getStreamTailSeq`，同 `_wireCodeRunnerDeps` 手法）。**配套基础设施**：`evals` 此前**无出口桶、无模块别名** ⇒ 新建 `app/src/evals/index.ts`（R03-002 出口）+ `app/tsconfig.json` 增 `@modules/evals` 别名（否则只能引子目录 ⇒ 触 R03-002）。
   > ⚠️ **v1 现状（如实，勿当已完成）**：
   > ① **LLM 复核（D3）尚未接线** ⇒ 可疑轮记 `reviewSkipped: 'no-model'`（端口刻意暴露该事实，不伪造"已复核"）；
   > ② 覆盖范围 = **本进程已加载的会话**（`host.chatSessions`）；历史会话补评需接 `listSessionsTouchedSince`。
6. ✅ **消费点 —— 已完成（2026-10-06；用户裁定 = 方案 (a) 新增 core SPI）**：
   - 🆕 core SPI [`SessionQualityService.ts`](file:///e:/PY/Documents/CODES/PY_APP/app/src/core/spi/SessionQualityService.ts)（`ISessionQualityPort` + **转发代理** + `registerSessionQualitySpi`；**未注册 ⇒ `null`**，与 D-148 `IKnowledgeGraphPort` 同构）；
   - 🆕 [`summarizeTurnQuality.ts`](file:///e:/PY/Documents/CODES/PY_APP/app/src/evals/online/summarizeTurnQuality.ts)（**纯函数**会话级摘要：`total`/`avgScore`/`highValueTurns`/`lowValueTurns`；阈值**复用 `weights.ts`**，不另立第二套判据）；
   - **装配**在 [`spiWiring.ts`](file:///e:/PY/Documents/CODES/PY_APP/app/src/entrypoints/spiWiring.ts)（entry 层，同既有 SPI 手法）：读事件（`getCoreAPI().getChatManager().readSessionEvents`，新增公共读方法）+ 纯函数摘要；
   - **消费**：[`AutoDream.buildSessionLines`](file:///e:/PY/Documents/CODES/PY_APP/app/src/chronos/autoDream/AutoDream.ts#L58-L85) 在会话清单每行**追加**质量摘要（上限 30 会话；取数失败只 `warn` + 不追加，**@ignore-catch** 说明为可选增益输入）。
   ⇒ **G4 达成**（≥1 真实消费方）。**infra→app 倒挂零新增**（`AutoDream` 仍只 import `@modules/core` / `@modules/core/spi`）。
7. ✅ **单测**：`turnQuality` 16 例 + `turnQualityEvaluator` 14 例 + `summarizeTurnQuality` 5 例 = **35 例**；§5 用例 1–7 已覆盖（含变异验证）；**用例 8（消费方端到端）**以"摘要纯函数 + SPI 装配"覆盖 —— **未做**"真跑一次梦境"的端到端（如实：梦境执行体涉及 LLM，不在单测范围）。
8. ✅ **回填**：本 spec + `dev_docs/任务计划-20261004.md` §19.4-U4。

> **接线进展**：
> ① ✅ **LLM 复核（D3）= 已完成（2026-10-06）**：🆕 [`chat/quality/turnQualityReviewer.ts`](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/quality/turnQualityReviewer.ts) 把 **`VerifierAgent` 装配为 `reviewTurn`**（模型**只**取 `modelRouter.resolveRole('verifier')`；未配置 ⇒ 工厂返回 `null` ⇒ 记 `reviewSkipped:'no-model'`，**不回退选模型**）；[`deriveTurnSignals`](file:///e:/PY/Documents/CODES/PY_APP/app/src/evals/online/deriveTurnSignals.ts) 增"该轮**正文摘录**"（≤4000 字符 + `replace:true` 清空重建语义）作为复核**最小输入**；接线于 `ChatOrchestrator.onIdle`。单测 +10 例（含**连续 4 轮不退化**的关键回归）。
> ② ✅ **历史会话补评 = 已完成（2026-10-06）**：会话范围改为 **本进程已加载 ∪ 磁盘层"最近更新的 N 个"** ——
> 经**既有** `SessionGateway.listSessions()`（与 `chat/manager/bootstrap.ts:413` 同源 ⇒ **不新增第二套会话枚举**）
> + 🆕 纯函数 [`rankRecentSessionIds`](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/quality/sessionScan.ts)
> （`updatedAt` 降序 / 按 id 去重 / 截断到 30；时间解析不出者**排最后**而非丢弃）；枚举失败 ⇒ `handleError` + 降级为
> "只用已加载会话"（不中断本次评估）。
> **口径说明（为何不取"全部会话"）**：更早的会话**不在梦境视野内**（梦境的会话来源本就是"最近被触碰的会话"）
> ⇒ 不为它们付费读事件。
> ⇒ **U4 至此无遗留**（D1–D6 全部落地）。

---

## 8. 合规清单

| 规则 | 结论 |
|---|---|
| GR15 Spec-Driven | ✅ 本 spec 先行（新模块 + **数据模型变更（新增事件类型）**） |
| CS01 归一化 | ✅ 复用 `VerifierAgent` / `IdleScaleMonitor` 缝 / 既有事件登记机制 / 既有 `EventLogStorage.read` 读取路径；**未新建评分框架、调度器或 reader**。⚠️ **刻意不消费** `computeBehaviorMetrics`（受其"仅观测、不得作判据"契约约束，见 D1） |
| 既有契约尊重 | ✅ **不改** `BehaviorMetrics` 的"仅观测"契约、**不改**其反向锁定测试；本评估器与 `tasks/behaviorFeedback.ts` 采取**同一取舍**（只取结果/成本类信号） |
| CS02 状态判据 | ✅ 可疑轮判定基于**结构化字段**（`status` 枚举 / 既有枚举化 verdict / 数值阈值），**无字符串匹配** |
| CS03 回退最小化 | ✅ 唯一降级 = "未配置 verifier ⇒ 跳过复核"（**语义为"不评"而非"假装评过"**，且**不**回退选模型） |
| CS04 Mock 零容忍 | ✅ 单测用**桩**注入 LLM 调用以断言"零调用"；生产无假数据 |
| CS05 根因优先 | ✅ 根因 = "无每轮质量信号" ⇒ 补信号 + 落事件 + 接消费方；非在展示层"补分数" |
| CS06 证据驱动 | ✅ §1 全部回仓取证；§D5 的"事件读取路径"**明确标为实施前待核实**，不臆断 |
| `model-usage.md` | ✅ 判分模型走 `TaskModelConfig.verifier` 分工；**无硬编码模型名/供应商名** |
| §1.6「模型可见 ⇔ 已落盘」 | ✅ 本批**按裁定登记事件**（可重建）；同时**如实说明**：当前分数**不注入模型** ⇒ 尚不构成"模型可见输入"（前置订正见头部） |
| R02 数据模型统一 | ✅ **不新增表**（避免双真相）；事件载荷类型落在既有 `LiriEventMap` 契约处 |
| R06-008 分层 | ✅ 评测域在 `evals/`（`app`）；接线经**动态 import**（同 onIdle 既有风格）；实施后以 `lint:arch` 验证 |

---

## 9. 跨路径评估入口裁定（P2-9，2026-10-10）—— **有意不做**

> 来源：`dev_docs/20261010/升级优化方案-20261010.md` §3 **P2-9**（外部核验项 M-8；报告 11 观察 3）。
> 问题：本仓"质量信号"是否需要一个**跨路径总线** —— 即"一个写入端、**任意路径**（单 agent / 普通工具路径）可查同源质量"？
> 口径（CS06）：下列 file:line 为 **2026-10-10 静态实测**；凡未经运行验证者标注"未实测"。

### 9.1 取证：三路 verifier 与其消费方（各自**本域**自洽）

| 路 | 信号 | 产生（写入端） | 消费方（实测） |
|---|---|---|---|
| **在线** | `turn/quality` 会话事件 | [`evals/online/turnQualityEvaluator.ts`](file:///e:/PY/Documents/CODES/PY_APP/app/src/evals/online/turnQualityEvaluator.ts)（空闲期 `runTurnQualityPass`） | ① **跨域**：`chronos/autoDream/AutoDream.ts` —— 经 `ISessionQualityPort`（**唯一**跨域消费方）；② 复核器 [`chat/quality/turnQualityReviewer.ts`](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/quality/turnQualityReviewer.ts) 复用 `VerifierAgent`（同域 app） |
| **循环** | `VerifierAgent` 三态（`APPROVE/REJECT/ESCALATE`） | [`query/VerifierAgent.ts`](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/VerifierAgent.ts) | **内建**于 `query/TAORLoop.ts`；`self_verify` 模式（`patternAssembler.ts`）+ `ChatManager.ts:3783`。均在 query/chat **本域**内闭环 |
| **协作** | 对抗批评 verdict | [`query/CompetitiveStrategyOrchestrator.ts`](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/CompetitiveStrategyOrchestrator.ts)（每候选独立 `VerifierAgent`） | `chat/launchers/PdcaLauncher.ts`（研究分流）。**本域**闭环（app） |

**关键取证（决定裁定的那条）**：跨**域**质量端口 `ISessionQualityPort`（[`core/spi/SessionQualityService.ts`](file:///e:/PY/Documents/CODES/PY_APP/app/src/core/spi/SessionQualityService.ts)）
的解析入口 `resolveSessionQuality()` / `getTurnQualitySummary()` 全仓**只有一个消费者** —— `chronos/autoDream/AutoDream.ts:59-61`
（装配见 `entrypoints/spiWiring.ts:325-353`）。

### 9.2 裁定：**不建跨路径总线**（维持现状，CS03）

| 判据 | 结论 |
|---|---|
| **是否有"真实第二消费者"** | ❌ **无**。除 `AutoDream` 外，无任何路径（单 agent / 普通工具 / 三路 verifier 的彼此）需要查询**同源**质量；三路各自在本域内闭环（§9.1） |
| **不做的代价** | 无 —— 现有能力（`turn/quality` 事件 + 本域 verdict）**不因缺总线而失效** |
| **做的代价** | 建一条**无消费者**的空总线：新增端口/装配面 + 长期维护 + 与 `CS01`（归一化：三路信号形状各异，强行统一即造第四套抽象）冲突 |
| 先例（**反面教材**） | `core/spi/CollaborationService.ts` 即"**预留端口、生产零消费者**"，已在 `README.md §二` 标注"**勿视为既有能力**"、入死面登记（UW 组）⇒ **不应再复制一个** |

⇒ **明确不做**（**intentionally deferred**）：**不得**为对齐 21 模式清单而建空总线（防 `CS04` 式"造形状"）。

### 9.3 重开触发条件（**立项判据 = 有真实第二消费者**）

**同时满足**下列任一**真实**需求时，方立项评估跨路径总线：
- **R1**：出现"**单 agent 路径**或**普通工具路径**需查询**同源**质量（`turn/quality` 摘要）"的**真实调用点**（≥1 个非 `AutoDream` 的生产消费者，须给出 file:line）；
- **R2**：三路 verifier 出现"**彼此**需交换质量结论"的真实场景（如协作路需读在线路的轮次分数），且经证明**本域复用**无法满足；
- **R3**：出现"**质量查询**在多路径间**口径不一致**导致用户可见缺陷"的真实事故。

> 判据纪律：R1–R3 任一条须**先取证**（真实调用点 / 真实事故），**不得**以"某模式清单里写了要总线"为由立项。

### 9.4 合规

| 规则 | 结论 |
|---|---|
| GR15 Spec-Driven | ✅ 本裁定落在**端口起源 spec**（单一事实源），未新建入口 |
| CS03 回退/新增最小化 | ✅ 无消费者 ⇒ **不做**（非"以防万一"预留） |
| CS06 证据驱动 | ✅ §9.1 全部回仓取证；"仅一个消费者"为全仓 `resolveSessionQuality` 扫描结论 |
| CD07（关键域禁以静态零引用删除） | ✅ **未删任何实现**；本裁定只"不新增"，既有端口/实现**保留** |
