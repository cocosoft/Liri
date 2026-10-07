# Spec：跨路径评估「写入端」收口（`IEvaluationPort` 评估）

> 版本 1.0 ｜ 创建 2026-10-07 ｜ 状态：🟢 **已评估（2026-10-07）—— 结论：不立项**（依据见 §1/§4；同源 §11-A6 已裁定不实施）
> 来源：台账 `dev_docs/任务计划-20261004.md` §24.4 **R11-2**（报告 11 §五-P1；同源 §11-A6「EvalBus」）
> 关联规则：GR15（Spec-Driven）/ **CS01（归一化）** / **CS03（回退最小化）** / **R12-1（防 CS03 滥用）** / CS06（证据驱动）/ R06-008（分层）
> 关联文档：`.trae/specs/online-quality-evaluation.md`（读取端 `ISessionQualityPort` 的来源 spec）· `dev_docs/任务计划-20261004.md` §11-A6 / §19.1-C-2 / §19.4-U9

---

## 1. Problem Statement（回仓取证，2026-10-07 实测）

**原始提案**：三路 verifier（**协作 / 循环 / 在线**）的 verdict **写入端**统一为 `core/spi` 的
`IEvaluationPort`（读取端已由 `ISessionQualityPort` 起步）。

| # | 事实 | 证据 |
|:-:|---|---|
| 1 | **统一写入抽象不存在** | `IEvaluationPort` / `EvaluationPort` / `EvalBus` / `emitEvaluation` 全仓 **0 命中**；`recordEvaluation` 4 命中**全在 `compaction/`**（上下文压缩评估，与 verifier 无关）：`compaction/ContextEngine.ts:309`、`compaction/strategies/{ReactiveCompactStrategy.ts:80,ContextCollapseStrategy.ts:80,AutoCompactStrategy.ts:78}` |
| 2 | **读取端已存在但只服务梦境** | `core/spi/SessionQualityService.ts:53-62`（`ISessionQualityPort`）；`resolveSessionQuality` **唯一消费方** = `chronos/autoDream/AutoDream.ts:59`（装配 `entrypoints/spiWiring.ts:330-348`） |
| 3 | **同源项已裁定不实施** | §11-A6「评估可观测性割裂（`EvalBus`）」= §19.4-**U9**「✅ **不实施**（台账已裁定：无消费方）」；§19.1-**C-2**「总线不实施；'verifier 跨路径'**已达成**」 |
| 4 | **无跨路径汇总消费者** | 任务侧读 **DB**（`tasks/lro/reporting.ts:135-160`、`tasks/AuditReport.ts:74`）与梦境侧读 **事件**（`chronos/autoDream/AutoDream.ts:59-84`）**彼此隔离**；无任何消费者同时读取三路 |

## 2. 三路 verifier 的写入端现状（本 spec 的核心取证）

| 路径 | verdict 类型（定义处） | 产出点 | **去向** | 现有消费者 |
|---|---|---|---|---|
| **① 循环（loop）** | `VerificationResult`（`query/VerifierAgent.ts:39-52`：`passed`/`confidence`/`verdict`/`checks`/`checkPassRate`） | `query/VerifierAgent.ts:307-416` → 调用点 `query/TAORLoop.ts:928` | **(a) 只返回调用方 + (b) logger** —— `TAORLoop.ts:928-961` 仅 logger + `messages.push` / `stopReason`；**无事件、无 DB** | **无**（读不到）。官方口径：`evals/online/deriveTurnSignals.ts:35-38`「本仓**未持久化**每轮的 `VerifierAgent` verdict」 |
| **② 协作（ReviewGate）** | `VerificationResult` → **降维**为 `PlanReview`（`tasks/PlanReview.ts:35-43`：`stepId`/`pass`/`score`/`issues`/`summary`，**无 `verdict`/`confidence`**） | `tasks/review/ReviewGate.ts:246-284` | **(c) DB**：`tasks/lro/terminalHooks.ts:251` → `tasks/db/GoalMetricsService.ts:260-294` `INSERT INTO review_samples`（`review_pass_rate` / `steps_json`）+ checkpoint | 任务侧报告（`tasks/lro/reporting.ts:135-160`、`tasks/AuditReport.ts:74`） |
| **② 协作（AgentSwarm）** | `SwarmVerifyResult`（`tasks/swarm/AgentSwarm.ts:91-94`：`pass`/`feedback`） | `tasks/swarm/AgentSwarm.ts:362` | **(a) 只返回调用方 + (b) logger** —— 仅回填 `r.verify`/`r.feedback`（`AgentSwarm.ts:363-373`） | **无** |
| **③ 在线（online）** | `turn/quality` 事件载荷（`session/types/eventPayloads.ts:87-124`：`score`/`components`/`signals`/`review?{verdict,confidence,…}`） | `evals/online/turnQualityEvaluator.ts:251-328` | **(c) session 事件**：`turnQualityEvaluator.ts:328`（唯一写入点；装配 `chat/orchestrator/ChatOrchestrator.ts:560-577`） | 梦境（`chronos/autoDream/AutoDream.ts:59`，经 SPI 汇总） |

> **⚠️ 顺带如实记录（非缺陷）**：**循环路径的 verdict 不落任何盘**（仅 REJECT 有 `PitfallRegistry` 旁路：`VerifierAgent.ts:382-390` → `chat/launchers/PdcaLauncher.ts:116-127`，那是"经验注册表"而非 verdict 持久化）。这是 §11-A6「评估可观测性割裂」的**实质内容**，也是 §2.3-v1 边界的已登记事实。

**三路去向互不相通**：`未持久化` / `DB(review_samples)` / `事件(turn/quality)` —— 三种语域，无一被同一消费者读取。

## 3. 目标 / 非目标

**若立项的目标（可验证）**
- **G1**：三路 verdict 经由**单一** `core/spi` 端口写入（写入端收口），消除"三套去向"。
- **G2**：≥1 个**真实**消费方能跨路径读取（否则就是第二个 N-79/N-80，违反 CS03/R12-1）。
- **G3**：分层层序不新增倒挂（`infra → app` 零新增，沿用推送模型 + 端口）。

**非目标（明确不做）**
- **N1**：**不**改三路各自的**判定语义/阈值**（本项只谈"写入端"，不碰判决逻辑）。
- **N2**：**不**新建第二套评估框架/总线（`EvalBus` 已裁定不实施，勿换名复活）。
- **N3**：**不**为"统一"而把三种不同语义（回合内自纠 / 任务级门禁 / 空闲期质量分）强行同构。

## 4. 决策点

### D1：是否立项「三路 verdict 写入端统一（`IEvaluationPort`）」？ —— **建议：不立项**

| 理由 | 依据 |
|---|---|
| ① **无真实消费者**（提案未给出消费方） | §1-4；**G2 不可达** ⇒ 建即死抽象（CS03 / R12-1 / N4「无触发场景不立项」） |
| ② **三路语义本就不同**，统一写入会把异质内容压成同构 | §2：循环=回合内自纠、协作=任务级门禁（且 **ReviewGate 已降维丢 `verdict`/`confidence`**）、在线=空闲期每轮质量分 |
| ③ **同源项已裁定不实施** | §1-3（§19.4-U9 / §19.1-C-2）；本案若立项须先证伪该裁定 |
| ④ **读取端无跨路径诉求** | §1-2：`ISessionQualityPort` 唯一消费方是梦境，只读 `turn/quality` 汇总 |

### D2（**仅当 D1 裁决为立项时才需定**）：统一形态

- **备选 a（倾向）**：新增会话事件（如 `validation/verifier_verdict`），三路在**各自产出点**写入；
  读取端新增/扩展端口消费。**代价**：三处事件契约同批 + 三处接线 + 事件量上升。
- **备选 b（不适用）**：扩 `turn/quality` 的 `review` 字段承接三路 —— ❌ 循环/协作**不是"轮"语义**，
  强行复用会把任务级/转级结论塞进轮级事件（语义污染）。
- **备选 c（不适用）**：把三路都写库 `review_samples` —— ❌ 该表字段是**任务级**（`pdca_task_id` 主键语义，`GoalMetricsService.ts:260-294`），轮级结论无处安放。

## 5. 影响文件（**预计**；仅当立项才动）

| # | 文件 | 改动（若立项） |
|:-:|---|---|
| 1 | `app/src/core/spi/EvaluationService.ts` | **新建**端口（`IEvaluationPort` + `register/resolve` + `*_SERVICE_ID`，未注册 ⇒ noop） |
| 2 | `app/src/session/types/{eventNames,eventPayloads,knownEventTypes}.ts` + `client/src/types/events.ts` | 若走备选 a：新事件**四处同批**（§1.6 红线） |
| 3 | `app/src/query/TAORLoop.ts` · `app/src/tasks/review/ReviewGate.ts` · `app/src/evals/online/turnQualityEvaluator.ts` | 三处产出点接线 |
| 4 | `app/src/entrypoints/spiWiring.ts` | 装配（推送模型） |
| 5 | `app/tests/`（新增端口契约 + 三路写入用例） | 新建 |

## 6. 验收

**本次（结论=不立项）**
- [x] 三路写入端去向**逐路取证**（file:line），无臆测（§2）。
- [x] 统一写入抽象"不存在"以 **grep 0 命中** 证伪（§1-1）。
- [x] 判定与 §11-A6 / §19.4-U9 既有裁定**一致**（§1-3）。
- [x] 结论 + 触发条件写入本 spec 并回填台账（§24.4-R11-2）。

**若将来立项时**（触发条件见 §7）
- [ ] G1（单一写入端）/ **G2（≥1 真实消费方，缺此则不立项）** / G3（零新增倒挂）逐条验证。
- [ ] `bun run typecheck` 0 · 全量 `bun test` 绿 · `lint:arch` 违规 0。

## 7. 风险与边界（如实）

1. **不是"缺口已修"** —— 本 spec 的结论是"**维持现状**"。循环路径 verdict 不落盘这一**可观测性空白**仍然存在（§2 注），它属 **§11-A6** 的范畴，**未被本 spec 关闭**。
2. **重新评估的触发条件**（任一成立即可重开 D1）：
   - 出现**真实消费方**需要跨路径读取 verdict（如梦境/离线分析明确要吃"任务级门禁结论"）；
   - 出现**合规/审计**要求（需从事件重建"当时哪条 verdict 被采纳"）；
   - 循环路径需要**回放**其 verdict（当前只能从 `messages` 事后推断）。
3. **反面代价（若贸然立项）**：新增端口 + 事件契约 + 三路接线，却在**无消费者**下运行 ⇒ 正是 R12-1 要防的"CS03 滥用"式膨胀。
4. **不改任何现有行为**：本案结论为不立项 ⇒ **零代码改动**、零契约变更。

## 8. 合规检查清单

| 规则 | 判定 |
|---|---|
| **GR15**（Spec-Driven） | ✅ 本 spec 即立项产物（结论=不立项，含证据与触发条件） |
| **CS01**（归一化：新增前先查已有） | ✅ 先证 `IEvaluationPort`/`EvalBus`/`recordEvaluation` 现状（0/无关命中） |
| **CS03**（回退策略最小化 / 不建无消费者抽象） | ✅ 无消费者 ⇒ 不建（G2 为硬门槛） |
| **R12-1**（防 CS03 滥用） | ✅ 与既有 **N-79/N-80/U9** 同判据（"无消费者不造能力"） |
| **CS06**（证据驱动） | ✅ §1/§2 全 file:line；含"未持久化"的官方口径引用 |
| **R06-008 / R00-001**（分层） | ✅ 若立项，须走推送模型 + `core/spi` 端口（infra→app 零新增） |

## 9. 实施记录

**2026-10-07（R11-2）**：评估完成，**结论 = 不立项**（D1）。取证：三路写入端逐路实测（§2）+
统一抽象 grep 证伪（§1-1）+ 读取端消费方唯一性（§1-2）+ 同源既有裁定（§1-3）。
**零代码改动**；台账 §24.4-R11-2 回填为"✅ 已评估（不立项）"。
