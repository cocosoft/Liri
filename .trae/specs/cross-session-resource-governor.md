# Spec：跨会话资源治理（准入 / 优先级 / 抢占）

> 版本 1.2 ｜ 创建 2026-10-05 ｜ 更新 2026-10-07 ｜ 状态：**阶段 1 🟢 已实施**（D1=A / D2=调用方显式传入 / D3=默认关 / D4=仅告警不拦截 / D5=只读聚合视图 —— 见 §6.5）；**阶段 2（P26-1）🟢 计划定稿 + 已裁定（D6=B / D7=排队）⇒ 待实施**（见 §9）
> 来源：`dev_docs/任务计划-20261004.md` §13.1 **A5**「全局资源治理缺失：预算控制分散在 3–4 层，无跨会话优先级调度与抢占」（原报告第二梯队建议 #5「单一 `ResourceGovernor` 并把路由与预算打通」）
> 关联规则：GR15（Spec-Driven）/ GR01（基础设施复用）/ CS01（归一化）/ CS02（状态判定）/ CS03（回退最小化）/ CS05（根因优先）/ R06-008（分层）
> 前置：预算侧"单一入口"已由 [budget-policy-layer.md](./budget-policy-layer.md) 收口（`BudgetPolicy` 契约 + 注册表，2026-09-25 已实施）⇒ **本 spec 不重复做预算策略，只做「调度维度」**。

---

## 1. Problem Statement（回仓取证，file:line 为 2026-10-05 实测）

### 1.1 预算已分层存在，但**准入处无统一判定**（不与 budget-policy-layer 重复）

| 设施 | 层级/作用域 | 现状证据 |
|---|---|---|
| `TokenBudgetController` | **按实例**（`budget.remaining` 在实例内） | `app/src/tokenBudget/TokenBudgetController.ts:128/204/208` |
| `UnifiedTokenTracker` | 状态**按会话**（`streamSessions: Map`） | `app/src/tokenBudget/UnifiedTokenTracker.ts:189/243/289` |
| `DailyBudgetManager` | 全局日账本，但**多实例并存** | 单例：`chat/orchestrator/preSendContextProtection.ts:65-76`；**TAORLoop 又各建一个**：`query/TAORLoop.ts:516` ⇒ 同进程多份互不共享账本 |
| `DailyBudgetManager` 存储 | **纯内存**（`restore()` 无消费者 ⇒ 重启丢失） | `query/DailyBudgetManager.ts:215` |
| ~~`MoaCostController`~~ | ~~**死代码**（无生产实例化，仅 re-export）~~ ⇒ ✅ **已删除（2026-10-06，用户裁定）**：整文件（class + `getModelCostPerToken` + `MoaBudget`/`CostEstimate`/`CostSnapshot`）5 个导出**全部 0 消费**；`MODEL_COST_MAP` 已退化为空 `{}`；同步移除 `agent/moa/index.ts` 的两处 re-export。**本行原证据地址已随删除失效**（台账 N-77） |
| `CostBudgetManager`（美元） | 仅 HTTP 查询消费，不参与准入 | `cost/CostBudgetManager.ts:71/525`；`infrastructure/http/handlers/cost-handlers.ts:77/157` |
| `session/budget/BudgetEnforcer` | 按 sessionId 的 allow/warn/reject（**2026-10-06 收敛**：原含 `downgrade` + `downgradeThreshold` —— 因 **不可达**（`setSessionBudget` **0 调用方** ⇒ `budgetConfigs` 恒空 ⇒ `evaluate()` 恒 `allow`）、**0 消费者**，且「预算吃紧 ⇒ 自动换模型」与「模型选择不得擅自变更用户所选」**冲突** ⇒ 已删除；见台账 N-80 / 计划 U5） | `session/budget/BudgetEnforcer.ts:8`。**附带核实**：`checkBudget` / `canProceedWithBudget` **亦 0 调用方**；整模块唯一在用的是 `recordTokenConsumption`（`voice/VoiceSession.ts:590`） |
| 策略契约 | `BudgetPolicy` + 注册表（已实施） | `budget-policy-layer.md §6.5` |

### 1.2 调度 / 抢占**完全缺失**（本 spec 的主体缺口）

- 关键词 `preempt` / `preemption` / `PriorityScheduler` 全仓 **0 命中**。
- `SimpleMutex`（`core/SimpleMutex.ts:7`）为**FIFO、无优先级、不可抢占**（`acquire/release/run`，默认超时 30s `:13`）；被会话串行闸复用（`ChatManager._sessionMutexes:372`、`ChatOrchestratorHost.sessionMutexes:119`）。
- 已有"优先级队列"骨架但**不可直接复用**：`chat/services/MessageQueue.ts:23`（四档 `MessagePriority`，`session/types/message.ts:76`；用于**消息投递**非 LLM 请求准入）；`ttsProvider.ts:215 TTSPriorityQueue`（**文件内私有类**）。
- 已有"资源抢占式排队 + 插队"**原型**：`workspace/OrchIntelligence.ts:651 ResourceScheduler`（`requestResource` `:665` 按 priority 降序入 `waitQueue` `:706`、`releaseResource` `:728`、`jumpQueue` `:748`、单例 `:797`）——语义是"工作项 vs 资源锁"，**未被主对话链使用**。

### 1.3 在飞会话集合已存在但**分散、无统一视图**

| 载体 | 证据 |
|---|---|
| `ChatManager._sessionAbortControllers: Map<sessionId, AbortController>` + `isSessionStreaming()` + `abortSessionStream()` | `chat/ChatManager.ts:377/383/391` |
| `ChatManager._sessionMutexes: Map<sessionId, SimpleMutex>` | `chat/ChatManager.ts:372` |
| `planAbortRegistry.loopByTask` + `abortSessionPlans(sessionId)` | `chat/planAbortRegistry.ts:45/79` |

⇒ 缺口：**无统一只读视图**（谁在飞、什么优先级、占用多久），无变更事件。

### 1.4 中止机制齐备，但"抢占"会**丢弃**在飞工作

- 会话流中止：`ChatManager.abortSessionStream(sessionId)`（`ChatManager.ts:391`，内部 `abortSessionPlans` `:394` + `controller.abort` `:404`）——**不保存检查点**。
- 可恢复中止：`TAORLoop.abort(saveCheckpoint = true)`（`query/TAORLoop.ts:2116/2125`）→ `resumeFromCheckpoint`（`:1788`）+ `ResumeManager`（`query/ResumeManager.ts:41/267`）。
- PDL 用户中止走 `abort(false)`（**放弃语义**）：`tasks/PlanDrivenLoop.ts:479/501`。
- 前端停止 = 同一 `abortSessionStream`。

### 1.5 唯一准入点（chat 层）

```
HTTP: chat-handlers.ts:185 handleChatCompletions → :426 handleStreamingChat → :635 coreAPI.chatStream
渠道: channels/routing/messageRouter.ts:661 coreAPI.chatStream
service: runtime/api/CoreAPIImpl.ts:691 chatStream → :816 chatManager.streamMessage
app: chat/ChatManager.ts:4035 streamMessage → ChatOrchestrator.ts:1108 streamMessage
     → streamMessageFlow.ts:1342 `await mutex.acquire()`  ← **唯一串行准入点**
```
> ⚠️ 双轨：非流式走 `CoreAPIImpl.chat()` → `ChatOrchestrator.sendMessage`（`ChatOrchestrator.ts:561` 的 `mutex.run`）。治理点须覆盖两条或明确只覆盖流式。

### 1.6 分层约束

`scripts/modules-to-layers.json`：`chat`/`tokenBudget`/`tasks` = **app**（`:43/46/50`）；`runtime`/`infrastructure` = **service**（`:79/77`）；`core → [core]`（`:8-15`）。
⇒ 治理器需读 `chat`（在飞集合）+ `tokenBudget`（水位）⇒ **必须落 app 层**；service 层入口只能经既有 sanctioned 手法（动态 import / 注入，见 `chat-handlers.ts:238`、`CoreAPIImpl.ts:711/816`）触达。

---

## 2. 目标 / 非目标

**目标（待 D1 裁定范围）**
- G1：新增 **app 层** `resourceGovernor`（唯一实例）——聚合**只读在飞视图**（sessionId → 优先级/起始时间/是否被抢占）+ **优先级准入** + **并发上限**。
- G2：**优先级来源结构化**（闭集枚举，CS02 禁字符串匹配）：`interactive`（人工对话，默认）> `background`（渠道/定时/后台任务）。
- G3：**抢占**（若 D1 选 B/C）：高优先级请求在并发满时，按策略抢占**最低优先级且跨会话**的在飞请求。
- G4：**至少一条真实接线**（避免空壳）：准入判定接在 `streamMessageFlow.ts:1342` 的 `mutex.acquire()` **之前**（或 `ChatManager.streamMessage` 入口），并覆盖非流式 `sendMessage`（若 D1 含）。

**非目标（明确不做）**
- N1：**不改任何预算算法/阈值**（`UNIFIED_THRESHOLDS`、`DailyBudgetManager` 三档、`BudgetPolicy` 均不动）。
- N2：**不合并** `tokenBudget` / `CostBudgetManager` / `session/BudgetEnforcer` 的实现（仅**只读聚合**；合并属独立工程）。
- N3：不新建 DB 表；不改数据模型；不做 UI（配置组可选，见 D3）。
- N4：不引入新依赖（`p-limit`/`p-queue` 全仓 0 命中，不引入）。
- N5：不做"跨作用域联合优化"（预算 × 调度的公式联动）。
- N6：不迁移 `workspace/OrchIntelligence.ResourceScheduler` 的既有消费者（只**借用其排队/插队语义**，不改造它）。

---

## 3. 设计（三选项，供 §4 裁定）

### 3.1 共用基础（A/B/C 都含）

`app/src/resourceGovernor/`（新 app 模块，`modules-to-layers.json` 登记 `{layer:'app'}`）：

```ts
/** 优先级（闭集枚举，CS02；非用户可见文案） */
export type RequestPriority = 'interactive' | 'background';

export interface InFlightEntry {
  sessionId: string;
  priority: RequestPriority;
  startedAt: number;
  /** 被抢占标记（幂等；用于前端/日志区分"用户中止"与"被抢占"） */
  preempted?: boolean;
}

export interface AdmissionRequest {
  sessionId: string;
  priority: RequestPriority;
}

export interface AdmissionDecision {
  admitted: boolean;
  /** 未准入原因（结构化，非文案） */
  reason?: 'concurrency_limit' | 'preempted_lower';
  /** 被抢占的会话（抢占发生时） */
  preempted?: string[];
}

export class ResourceGovernor {
  /** 只读在飞视图（快照） */
  snapshot(): readonly InFlightEntry[];
  /** 准入（同步判定；不阻塞等待 —— 见 D1） */
  admit(req: AdmissionRequest): AdmissionDecision;
  /** 请求结束（释放名额） */
  release(sessionId: string): void;
  /** 清空（仅测试） */
  reset(): void;
}
export function getResourceGovernor(): ResourceGovernor;
```

- **复用**（GR01/CS01）：`MessagePriority` 的"分档"思路（不直接复用其类型，语义不同）；`ResourceScheduler` 的"priority 排序 + jumpQueue"**语义**（`:665-767`）；`SimpleMutex` 保持不动。

### 3.2 方案 A（最小：准入 + 上限，**不抢占**）

- 并发上限默认取既有 `getTaskConcurrencyLimits().agentConcurrency`（`tasks/limits.ts:37-44`）或新 env `RESOURCE_MAX_INFLIGHT`。
- 超限 ⇒ `admit` 返回 `{admitted:false, reason:'concurrency_limit'}`，**接线点决定行为**（拒绝 / 排队 / 沿用现状）。
- 收益：**可观测 + 上限护栏**；零丢弃风险。局限：不解决"高优先级挤不进"。

### 3.3 方案 B（准入 + 抢占=中止，**丢弃**低优先级在飞）

- 高优先级到达且并发满 ⇒ 选**最低优先级且跨会话**的在飞请求 ⇒ 调 `ChatManager.abortSessionStream(victim)`（`ChatManager.ts:391`），并在 `InFlightEntry` 标 `preempted:true`。
- 优点：改动小（复用既有中止入口）。
- 代价（如实）：被抢占请求**不可恢复**（`abortSessionStream` 不落检查点）；用户可见"回复突然中断"。

### 3.4 方案 C（准入 + 抢占=**挂起可恢复**）

- 抢占走 `TAORLoop.abort(saveCheckpoint=true)`（`query/TAORLoop.ts:2116`）+ `PDL` 的检查点路径（需新增 `abort(saveCheckpoint)` 语义，当前为 `abort(false)` 固定，`PlanDrivenLoop.ts:501`），恢复经既有 `resumeFromCheckpoint` / `ChatManager.resumeStream`（`ChatManager.ts:4074`）。
- 优点：抢占不丢工作。
- 代价（如实）：触达 TAOR/PDL 生命周期与检查点存储；**改动面与风险显著大于 B**，且需产品裁定"抢占后自动恢复 vs 用户手动恢复"。

---

## 4. 决策点（**待用户裁定**）

| ID | 决策项 | 选项 | 建议 |
|:--:|---|---|---|
| **D1** | 范围 | (a) **A**：仅准入 + 并发上限（不抢占）／(b) **B**：A + 抢占=中止（丢弃）／(c) **C**：A + 抢占=挂起可恢复／(d) 整体不做 | 建议 **(a) 先行**：先拿到"统一在飞视图 + 上限"的实际收益；抢占（B/C）风险与产品语义重，宜独立裁定 |
| **D2** | 优先级来源 | (a) **调用方显式传入**（`StreamMessageOptions.priority?`，缺省 `interactive`）／(b) 按入口推导（HTTP/REPL=interactive，渠道/定时/后台=background）／(c) 配置表 | 建议 **(a)+(b)**：默认 interactive，渠道与后台任务入口显式传 background（`messageRouter`/cron 侧） |
| **D3** | 默认开关 | (a) **默认关**（`FEATURE_RESOURCE_GOVERNOR`，零行为变更）／(b) 默认开（仅上限生效） | 建议 **(a) 默认关**：与 `CODE_MODE` / `OUTPUT_GUARD` 同惯例，先灰度 |
| **D4** | 超限行为（D1=a 时） | (a) **直接拒绝**（返回错误/提示）／(b) **排队等待**（FIFO/优先级，超时放弃）／(c) 仅记录告警不拦截 | 建议 **(c) → 后续 (b)**：先观测再限流，避免突然拒绝用户请求 |
| **D5** | 统一账本 | (a) 仅**只读聚合视图**，不改 `DailyBudgetManager` 多实例／(b) 合并为单实例 | 建议 **(a)**：合并属独立工程（N2） |

> D1 决定 §3.2–3.4 哪一节展开；D4 仅在 D1=a 时有意义；D1 选 (d) 则本 spec 归档为"不实施"。

---

## 5. 影响文件（预计，以 D1 裁定为准）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `app/src/resourceGovernor/{types,ResourceGovernor,index}.ts` | **新建**：契约 + 实现 + 桶导出 |
| 2 | `scripts/modules-to-layers.json` | **改**：登记 `resourceGovernor` = app |
| 3 | `app/src/chat/orchestrator/streamMessageFlow.ts` | **改**：`mutex.acquire()`（`:1342`）前接准入 + 结束 `release` |
| 4 | `app/src/chat/orchestrator/ChatOrchestrator.ts` | **改**：非流式 `sendMessage`（`:561`）同点接线（若 D1 含非流式） |
| 5 | `app/src/core/featureFlags.ts` | **改**：`RESOURCE_GOVERNOR`（默认 false，若 D3=a） |
| 6 | `app/tests/resourceGovernor/*.test.ts` | **新建**：准入/上限/优先级/抢占（视 D1） |

---

## 6. 验收方案

| 项 | 通过标准 |
|---|---|
| 类型/架构 | `typecheck` 0；`lint:arch` 不新增错误（新模块层登记后无倒挂） |
| 只读视图 | `snapshot()` 返回在飞会话（sessionId/priority/startedAt）；`admit`→`release` 后为空 |
| 优先级 | `interactive` 先于 `background` 获得名额（D1=b/c 时：跨会话才可被抢占，**不得抢占同会话**——会与既有 `_prepareStreamSession` 顶替语义冲突，`ChatManager.ts:2989-2993`） |
| 上限 | 达上限时按 D4 行为一致；`release` 后名额可复用 |
| 默认关 | `FEATURE_RESOURCE_GOVERNOR=false` ⇒ 准入恒 `admitted:true`、零行为变更（全量 `bun test` 0 fail） |
| 抢占（若 D1=b/c） | 被抢占会话被中止且标 `preempted:true`；D1=c 时经 `resumeFromCheckpoint` 可续跑 |
| 未做（明确） | 预算算法/合并（N1/N2）/UI（N3）/新依赖（N4）/联合优化（N5） |

---

## 7. 合规检查清单

| 规则 | 结论 |
|---|---|
| GR15 Spec-Driven | ✅ 先 spec，裁定后动码 |
| GR01 基础设施复用 | ✅ 复用 `abortSessionStream` / TAOR checkpoint-resume / 会话 Map；借用 `ResourceScheduler` 语义（不复制类） |
| CS01 归一化 | ✅ 已检索：`ResourceGovernor` 全仓 0 命中；`preempt|PriorityScheduler` 0 命中；既有"队列/闸"清单见 §1.2（不复用它们的原因：语义不同或文件内私有） |
| CS02 状态判定 | ✅ 优先级/原因用闭集枚举与结构字段，非用户可见字符串 |
| CS03 回退最小化 | ✅ 默认关 + 先观测；不做"以防万一"的兜底分支（D4 建议 c） |
| CS04 零 Mock | ✅ 计划中无 mock |
| CS05 根因优先 | ✅ 根因＝"无跨会话调度维度 + 在飞集合无统一视图"，而非"预算算错" |
| R06-008 分层 | ✅ 治理器落 app；service 入口经既有动态 import/注入手法 |
| PY_APP §2 简洁优先 | ✅ 不引入 `p-limit`/DI 容器/新表；先做 A 再议 B/C |

---

## 6.5 实施结果（2026-10-05，用户裁定 D1=A / D2=调用方显式传入 / D3=默认关 / D4=仅告警不拦截）

| 项 | 结果 |
|---|---|
| G1 治理器 | ✅ 新建 **app 模块** `app/src/resourceGovernor/`：`index.ts`（`ResourceGovernor` 类 + `getResourceGovernor()` 单例 + `resetResourceGovernorForTest()` + `DEFAULT_MAX_INFLIGHT_SESSIONS=8`）+ `types.ts`（纯类型）；已登记 `scripts/modules-to-layers.json`（`resourceGovernor` = app）与 `app/tsconfig.json` 路径别名 |
| 在飞只读视图 | ✅ `snapshot()`（按 `startedAt` 升序，返回副本）；`count()`；`admit` **同 sessionId 幂等**（保留首次 `startedAt`）；`release` 幂等 |
| 上限**观测** | ✅ 超过上限 ⇒ `logger.warn` + `overLimit:true`，**`admitted` 恒 `true`（不拦截，D4）** |
| G2 优先级 | ✅ 单一事实源 **core 层** `app/src/types/requestPriority.ts`（`REQUEST_PRIORITIES` / `RequestPriority` / `DEFAULT_REQUEST_PRIORITY`）；`SendMessageOptions.priority?`（`session/types/message.ts`，`StreamMessageOptions` 继承）—— 落 core 是为**避免 `session`(service) → app 倒挂** |
| G4 真实接线 | ✅ **两条路径**：流式 `streamMessageFlow.ts`（`mutex.acquire()` 前 `admit`、唯一 `mutex.release()` 处 `release`，与 `mutexHeld` 同生命周期）；非流式 `ChatOrchestrator.sendMessage`（`mutex.run` 前置 `admit`，`.finally` 释放） |
| 开关 | ✅ `FEATURE_RESOURCE_GOVERNOR`（`core/featureFlags.ts`，**默认 false**；判定**内聚在治理器内** ⇒ 调用方无分支、关闭时零行为变更） |
| 测试 | ✅ `app/tests/resourceGovernor/resourceGovernor.test.ts` **8 例**（开关关闭零变更 / 登记与视图 / 幂等 / 超限仍放行 / 快照排序 / reset / 非法上限回退 / 单例） |
| 门槛（实测） | `typecheck` **0** · `eslint` 新增与改动文件 **0 error** · `lint:arch` **错误 0 / 警告 4（回基线）** · `lint:size` **错误 0 / 警告 463（回基线）** · 全量 `bun test` **4577 pass / 21 skip / 0 fail**（4598 tests / 484 文件） |

**与 spec 的偏离（如实）**

1. **文件形态**：§5 预列 `resourceGovernor/{types,ResourceGovernor,index}.ts` 三文件 ⇒ 实际 **2 文件**（实现并入 `index.ts`）。原因：顶层模块的**纯 re-export barrel** 触发门禁 **R05-005**（实测新增警告 4→5）⇒ 把实现放进 `index.ts` 后警告回基线。
2. **未发事件总线**：§1.3 提到"变更事件"缺口 ⇒ 本批只用 `logger.warn`（避免新增事件名，事件名有单一事实源门禁）。"变更事件"留待有消费者时再做。
3. **上限为常量**（`DEFAULT_MAX_INFLIGHT_SESSIONS = 8`，可经构造参数注入）：未引入配置项/新 env 前缀（`project_rules §1.4` 前缀分类未含 `RESOURCE_*`）。

**未做（明确边界）**

- **抢占**（B/C 方案）：未实施 —— 用户裁定 D1=A。`abortSessionStream` 不落检查点的"抢占即丢弃"风险（§8-2）因此**未引入**。
- **排队 / 拒绝**：未实施（D4=仅告警不拦截）。
- **预算合并**：`DailyBudgetManager` 多实例、`CostBudgetManager`、`session/BudgetEnforcer` **仅只读聚合视图概念，未合并**（D5=a；`snapshot()` 目前**只含会话/优先级**，尚未把水位并进视图 —— 属后续增量）。
- **优先级透传**：⚠️ **生产侧当前实际恒为 `interactive`** —— `StreamMessageOptions.priority` 仅在 chat 层内部生效；渠道/HTTP 入口（`ChatRequest`）**未透传**。因 D4 仅告警不拦截，透传暂不产生行为差异 ⇒ 留待策略切换（B/C）时一并做。
- 治理器**尚无生产消费者**读取 `snapshot()`（无 UI/端点）—— 它是"接线就位、待消费"状态，不宣称已产生可观测收益。

---

## 8. 风险与边界（如实）

1. **收益边界（必须坦白）**：本仓**无正式用户**（`project_rules §1.3`）⇒ 跨会话争抢在单机单用户下**极少发生**；本 spec 的实际价值主要是**在飞视图可观测 + 上限护栏**，而非"解决真实拥塞"。若评审认为收益不足，建议只做 (a) 或整体不做。
2. **抢占的语义风险**：B 会**丢弃**用户可见回复（`abortSessionStream` 不落检查点，§1.4）；C 才能不丢，但需触达 TAOR/PDL 生命周期且要产品裁定恢复时机。
3. **不得抢占同会话**：既有"新请求顶替旧流"已由 `_prepareStreamSession`（`ChatManager.ts:2989-2993`）处理 ⇒ 治理器只处理**跨会话**，避免双重中止语义冲突。
4. **多实例账本**：`DailyBudgetManager` 多实例（§1.1）**不在本轮修复范围**（D5=a）；统一账本另立专项。
5. **双轨入口**：非流式 `sendMessage` 与流式 `streamMessage` 是两条路径（§1.5）⇒ 只接流式会产生"半覆盖"，需 D1 明确。
6. **对标口径**：原报告仅给方向（"单一 `ResourceGovernor`"），无实现 schema ⇒ 本 spec 不照搬外部设计，只落本仓最小可行形态。

---

## 9. 阶段 2 实施计划：抢占 + 优先级透传（P26-1，2026-10-07 制定；**D6/D7/D12/D13 已裁定**；**§9.1 ✅ · §9.2 ✅ · §9.4 ✅ 全部已实施** —— 见 §9.9）

> **来由**：台账 §26.2-**A5** 残余（"跨会话**无抢占**"仍未消除；优先级生产侧**恒 `interactive`**）⇒ 台账 §26.5 **P26-1**。
> **定位**：本阶段 = 上文 §3.3 **方案 B** / §3.4 **方案 C** + §4 的 **D2(b) 透传** + **D4(c)→(b) 升级**。
> **前置**：阶段 1（D1=A）已实施（§6.5）；本阶段**只增量**，不改阶段 1 已定的"只读视图 / 上限观测 / 开关默认关"（除非 §9.0 决策另有裁定）。

### 9.0 待裁定决策点（**阻塞项** —— 未裁定不动码）

| ID | 决策项 | 选项 | 建议 |
|:--:|---|---|---|
| **D6** | 抢占语义 | (a) **B**：抢占=**中止并丢弃**（复用 `ChatManager.abortSessionStream`）／(b) **C**：抢占=**挂起可恢复**（`TAORLoop.abort(true)` + `resumeFromCheckpoint`）／(c) **不抢占**（仅做 D2 透传 + D4 排队） | **(a) 先行** —— B 改动面小、复用既有中止入口；C 触达 TAOR/PDL 生命周期且需产品裁定"自动恢复 vs 手动恢复"（§3.4 / §8-2 已如实记录代价） |
| **D7** | 超限行为 | (a) 维持**仅告警**（现状 D4=c）／(b) **排队**（优先级队列 + 超时放弃）／(c) **拒绝** | **(b)** —— 与抢占配套；拒绝会突然打断用户（§4-D4 建议先观测后限流，观测已就绪） |

> D6=c 时本阶段退化为"仅 D2 透传 + D7"，工作量约为 D6=a 的 1/3。

> **✅ 裁定（2026-10-07，用户）**：**D6 = (a) B**（抢占 = 中止并丢弃，复用 `abortSessionStream`）· **D7 = (b) 排队**（优先级队列 + 超时放弃）。
> ⇒ 实施范围 = **§9.1 透传 + §9.2（B 案）+ §9.4 排队**；**§9.3（C 案）不做**（`PlanDrivenLoop.abort(saveCheckpoint)` 不在本批）。

> **✅ 补充裁定（2026-10-07，用户；§9.4 动码前）**
>
> | ID | 决策项 | 结论 |
> |:--:|---|---|
> | **D12** | 排队**等待超时后**如何处置（原 §9.4 写"回落为拒绝**或**告警"，二值未定） | **(a) 告警 + 放行** —— `logger.warn` 后照常继续，**不拒绝**（保持 D4「`admitted` 恒 `true`」，避免引入首个用户可感的拒绝路径） |
> | **D13** | 排队开关粒度 | **(a) 共用 `FEATURE_RESOURCE_GOVERNOR`**（默认 false）⇒ 默认关时抢占与排队**均**不生效，零行为变更；不新增开关（避免与 §24-R07-2「安全相关开关清单治理」组合维度膨胀） |

### 9.1 步骤 1：优先级透传（D2=b，**低风险先行**）

**现状缺口（实测 2026-10-07）**：`StreamMessageOptions.priority?`（`session/types/message.ts`）已存在，但**生产入口未透传** ⇒ `snapshot()` 中恒为 `interactive`（阶段 1 §6.5「未做」第 4 条）。

| # | 落点 | 改动 |
|---|---|---|
| 1 | `app/src/types/requestPriority.ts` | **复用**（core 单一事实源，CS01）—— 不改 |
| 2 | `ChatRequest`（HTTP 请求类型，`infrastructure/http/handlers/chat-handlers.ts` 使用） | 增可选 `priority?: RequestPriority`（**白名单收窄**：仅允许 `REQUEST_PRIORITIES` 成员，非法 ⇒ 回落 `DEFAULT_REQUEST_PRIORITY`） |
| 3 | `handleChatCompletions`（`chat-handlers.ts:185`）/ `handleStreamingChat`（`:426`） | 把 `body.priority` 透传进 `coreAPI.chatStream`（`:635`） |
| 4 | `runtime/api/CoreAPIImpl.ts:691 chatStream` → `:816 chatManager.streamMessage` | 透传 `priority` 至 `StreamMessageOptions` |
| 5 | `channels/routing/messageRouter.ts:661`（渠道入站） | 显式传 `priority: 'background'`（渠道**非人工实时**对话） |
| 6 | 定时/后台入口（`chronos` 触发会话、`dream` 等） | 同传 `'background'`（**只在事实上确为后台的入口**，不臆测） |
| 7 | `app/tests/resourceGovernor/*` | 新增：透传链断言（HTTP body → `snapshot()` 中 priority 一致） |

**验收**：`FEATURE_RESOURCE_GOVERNOR=true` 时 `snapshot()` 能区分 `interactive` / `background`；`=false` 时零行为变更。

### 9.2 步骤 2：抢占（D6=a 方案 B 展开）

**共用（B/C 都需）**

- `AdmissionDecision.reason` 扩展 `'concurrency_limit'`（已定义）+ 返回 `preempted: string[]`（已定义）。
- **victim 选择规则**（纯函数，可单测；CS02 用枚举不用字符串）：
  1. **排除同 `sessionId`**（硬约束 —— 同会话"新请求顶替旧流"已由 `_prepareStreamSession`（`ChatManager.ts:2989-2993`）处理，双重中止会语义冲突，§8-3）；
  2. 取**优先级最低**者（`background` < `interactive`）；
  3. 同级取 `startedAt` **最早**者；
  4. 无可抢占候选 ⇒ 按 D7 行为（排队 / 告警 / 拒绝）。
- 抢占后：`InFlightEntry.preempted = true`（**幂等**）+ `logger.warn` 留痕（含 victim/请求方）。

**B 方案落点**：治理器暴露 `onPreempt` 回调（**注入**，避免 app→chat 反向耦合成为硬边？—— 实测 `resourceGovernor` 与 `chat` **同为 app 层**，可直接引用；但为保持治理器"无副作用契约"，仍建议**回调注入**，由组合根装配）⇒ 回调实现调 `ChatManager.abortSessionStream(victim)`（`ChatManager.ts:391`）。

> ⚠️ **B 的如实代价**：`abortSessionStream` **不落检查点**（§1.4）⇒ 被抢占会话的用户可见回复**被丢弃**；须在 UI/日志区分"用户中止"与"被抢占"（`preempted` 标记即为此）。

### 9.3 步骤 3：抢占（D6=b 方案 C 展开，**仅当选 C**）

| # | 落点 | 改动 |
|---|---|---|
| 1 | `query/TAORLoop.ts:2116 abort(saveCheckpoint=true)` | **复用**（已支持落检查点） |
| 2 | `tasks/PlanDrivenLoop.ts:501` | 现固定 `abort(false)`（**放弃语义**）⇒ 需新增 `abort(saveCheckpoint: boolean)` 语义（PDL 检查点写入点见 `long_task` spec） |
| 3 | `chat/ChatManager.ts:4074 resumeStream` | **复用**为恢复入口 |
| 4 | 恢复时机 | **产品裁定**：抢占后**自动恢复**（治理器在名额释放后触发）vs **用户手动恢复**（仅置"已挂起"标记 + 前端提示） |

### 9.4 步骤 4：超限行为升级（D7=b，已落地 —— 见 §9.9.3）

> **实现取证（2026-10-07，CS06）**：原计划"复用 `workspace/OrchIntelligence.ResourceScheduler` 的排队/插队语义"**不完全可行** —— 该类 [`requestResource()`](../../app/src/workspace/OrchIntelligence.ts) 为**同步非阻塞**（只返回 `queuePosition`，**无 await / 无超时**），且以 `(workItemId, resource)` 为键。
> ⇒ 改在治理器内新建**极小等待原语**（优先级降序 + 同级 FIFO，与前者**口径对齐**而非复制其类）：语义仍是"排队/插队"，未复制 `ResourceScheduler` 本体。

- 队列须有**超时放弃**（`SimpleMutex` 默认 30s 为参考口径，`core/SimpleMutex.ts:13`）⇒ 超时按 **D12 = 告警 + 放行**。

### 9.5 影响文件（预计）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `app/src/resourceGovernor/{index,types}.ts` | 改：victim 选择 + `onPreempt` 注入 + `preempted` 标记（+ 可选队列） |
| 2 | `app/src/types/requestPriority.ts` | **不改**（复用） |
| 3 | `infrastructure/http/handlers/chat-handlers.ts`（`:185/:426/:635`） | 改：透传 `priority` |
| 4 | `runtime/api/CoreAPIImpl.ts`（`:691/:816`） | 改：透传 |
| 5 | `channels/routing/messageRouter.ts`（`:661`） | 改：`background` |
| 6 | `app/src/chat/orchestrator/streamMessageFlow.ts` / `ChatOrchestrator.ts` | 改：按 D7 决定是否"排队等待"（阶段 1 已接 admit/release） |
| 7 | `app/src/chat/ChatManager.ts`（:391 中止 / :4074 恢复） | 改（B/C 的 victim 处置；**注入回调**，不新增硬边） |
| 8 | `app/src/tasks/PlanDrivenLoop.ts`（:501） | 改（**仅 C**：`abort(saveCheckpoint)`） |
| 9 | `app/tests/resourceGovernor/*.test.ts` | 新建/扩：victim 规则（含**不得同会话**）、抢占标记、排队超时、默认关零变更 |

### 9.6 验收

| 项 | 标准 |
|---|---|
| 默认关 | `FEATURE_RESOURCE_GOVERNOR=false` ⇒ 透传/抢占/排队**全不生效**，全量 `bun test` 0 fail |
| 透传 | HTTP body `priority:'background'` ⇒ `snapshot()` 可见（`interactive` 默认不变） |
| victim 规则 | 高优先到达且并发满 ⇒ 抢占**最低优先 + 跨会话 + 最早**者；**同会话永不被抢占**（专测） |
| 抢占标记 | 被抢占会话 `preempted===true`；UI/日志可区分"用户中止" |
| B 案 | 被抢占会话确被中止 |
| C 案 | 被抢占会话可经 `resumeFromCheckpoint`/`resumeStream` 续跑（端到端 1 例） |
| 排队（D7=b） | 超限请求入队；名额释放后按优先级出队；超时按约定回落 |
| 回归 | `typecheck` 0 · `lint:arch` 不新增违规 · `lint:doc-code` 通过 · 全量 `bun test` 0 fail |

### 9.7 合规检查清单（本阶段）

| 规则 | 结论 |
|---|---|
| GR15 Spec-Driven | ✅ 本节即 spec；**D6/D7 裁定前不动码** |
| GR01 基础设施复用 | ✅ 复用 `abortSessionStream` / `TAORLoop.abort(true)` / `resumeFromCheckpoint` / `ResourceScheduler` 语义；不新建中止机制 |
| CS01 归一化 | ✅ 优先级类型复用 core `requestPriority.ts`；不加新类型 |
| CS02 状态判定 | ✅ `preempted`/`reason` 为结构化字段，非文案匹配 |
| CS03 回退最小化 | ✅ 默认关；**不引入"以防万一"分支**；D7=c（仅告警）为现状，不额外造兜底 |
| CS05 根因优先 | ✅ 根因＝"无跨会话调度维度"；抢占是调度语义而非预算问题（N1 不改预算） |
| R06-008 分层 | ✅ `resourceGovernor` 与 `chat` 同属 app；service 入口仍走既有动态 import/注入 |
| PY_APP §3 外科手术 | ✅ 只改透传链与 victim 处置，不动预算/模型选择 |

### 9.8 风险（如实，须在裁定前知悉）

1. **收益边界**（沿用 §8-1）：本仓**无正式用户**，单机单用户下跨会话争抢**极少发生** ⇒ 抢占的实际触发率低；本阶段价值主要在**语义完备**与**后台任务不挤占人工对话**。
2. **B 会丢弃用户可见回复**（§9.2 ⚠️）；若产品不能接受，须选 C（成本更高）。
3. **透传是"沉默收益"**：D7=c（仅告警）时透传**不产生行为差异** ⇒ 只有配合抢占/排队才有可见效果；单独做透传收益有限，**建议与 D7 同批**。
4. **不得抢占同会话**（硬约束，§8-3）—— 违反会与 `_prepareStreamSession` 顶替语义打架。
5. **PDL 的 `abort(saveCheckpoint)`**（仅 C）会触碰长任务中止语义 ⇒ 需回归 `tasks` 全量测试。

---

### 9.9 实施记录

#### 9.9.1 步骤 1（§9.1 **优先级透传**）—— 🟢 **已落地 2026-10-07**

**落点（实测回仓）**

| # | 落点 | 改动 |
|:--:|---|---|
| 1 | `app/src/types/requestPriority.ts` | **复用**已有枚举，另**新增** `parseRequestPriority(raw: unknown)` —— 边界白名单收窄的**单一实现**（CS01） |
| 2 | `runtime/api/CoreAPI.ts` | `ChatRequest` 增可选 `priority?: RequestPriority` |
| 3 | `infrastructure/http/handlers/chat-handlers.ts` | `ChatCompletionRequest` 增 `priority?: string`（原始输入）；流式构建处 `priority: parseRequestPriority(request.priority)` |
| 4 | `runtime/api/CoreAPIImpl.ts` | `chatStream` 内 `chatManager.streamMessage` options 增 `priority: request.priority` |
| 5 | `channels/routing/messageRouter.ts` | 入站 `coreAPI.chatStream({ …, priority: 'background' })`；**同批收窄该处 `chatStream` 端口类型**（原缺该字段 ⇒ 编译期即拦，实测 TS2353） |
| 6 | 定时/后台入口 | **无形落点** —— 实测 `CoreAPI.chatStream` 的**生产调用点仅** #3（HTTP）与 #5（渠道）；`chronos`/`dream` **不经** CoreAPI 对话入口 ⇒ **不臆测添加**（CS06/CS03） |
| 7 | `app/tests/resourceGovernor/requestPriorityTransmission.test.ts` | **新建（4 例）**：白名单收窄 / 非法+缺省回落 `undefined` / 缺省常量 / 透传后 `snapshot()` 可区分 `interactive` 与 `background` |

**边界语义**：非法值 / 缺省 / 非字符串 ⇒ `parseRequestPriority` 返回 `undefined`（**不报错、不猜测**，下游 `?? DEFAULT_REQUEST_PRIORITY`）—— 与"此前无该字段"完全等价 ⇒ **开关默认关时零行为变更**。

**未做（明确）**：非流式路径 `CoreAPIImpl.chat()` → `chatManager.sendMessage()` **不经治理器准入**（admission 仅接在 `streamMessageFlow:1193` / `ChatOrchestrator:676`）⇒ **未透传**（CS03：无消费者不加数据）。

**门禁（全绿）**：`typecheck` **0** · 改动文件 `eslint` **0** · `lint:arch` **违规 0 / 警告 4（基线）· 重复实现 0** · `lint:size` **0 错 / 470 警告 / 8 例外** · 全量 `bun test` **506 files / 4763 pass / 21 skip / 0 fail**（+1 文件 / +4 例，逐数吻合）。

**下一步**：§9.2（B 案抢占，D6=a）+ §9.4（排队，D7=b）—— 仍未动码。

#### 9.9.2 步骤 2（§9.2 **B 案抢占**，D6=a）—— 🟢 **已落地 2026-10-07**

**落点（实测回仓）**

| # | 落点 | 改动 |
|:--:|---|---|
| 1 | `resourceGovernor/types.ts` | `InFlightEntry` 增 `preempted?: boolean`（**幂等 + 留痕**双用途）；新增 `PreemptHandler` 类型；`AdmissionDecision` 增必填 `preempted: string[]`；`ResourceGovernorOptions` 增 `onPreempt?` |
| 2 | `resourceGovernor/index.ts` | 新增纯函数 `selectPreemptionVictim()` + `PRIORITY_RANK`（CS02：枚举映射，禁字符串比较）；`admit()` 超限分支改为**尝试抢占**（先标记 → 告警 → 回调）；新增类方法 `setPreemptHandler()` 与全局注入 `setResourceGovernorPreemptHandler()` |
| 3 | `bootstrap/pipeline/BootPipelineIntegrator.ts` | **组合根装配**（复用同处 `createChatManager()` 实例）：`setResourceGovernorPreemptHandler(victim => chatManager.abortSessionStream(victim))` —— 治理器**不硬依赖** chat 层（注入缝，同 `setCoreApiAppDeps` 先例） |
| 4 | `app/tests/resourceGovernor/preemption.test.ts` | **新建（11 例）**：victim 六规则（含**不得同会话**专测 · `background` 不得抢 `interactive` · 幂等跳过已抢占 · 最低优先 · 同级最早 · 无候选）+ 抢占生效（返回/标记/回调）+ 幂等（不重复回调）+ **未注入回调退回仅告警** + 开关关零变更 |

**victim 规则（四条，顺序不可调换）**：① 排除同 `sessionId`（硬约束）→ ② 排除**优先级不低于**请求者（防 `background` 抢 `interactive`，§9.8-1）→ ③ 排除已 `preempted`（幂等）→ ④ **最低优先**，同级取 **`startedAt` 最早**。

**语义细节（如实）**
- victim **保留在飞**（仅打标记；由 victim 自身 `release()` 移除）⇒ `preempted` 可持续供 UI/日志区分"用户中止"与"被抢占"。
- **未注入回调 ⇒ 退回阶段 1「仅告警」**（`preempted` 恒空）⇒ 默认零行为变更。
- **未加** `AdmissionDecision.reason`（本 spec 原记该字段"已定义"，**实测不存在**）：`overLimit: boolean` 已承载该信号且无消费者 ⇒ 不加（CS03）。
- `admit()` **保持同步**、不加 try/catch（回调为同进程内部调用；CS03 回退最小化）。

**门禁（全绿）**：`typecheck` **0** · 改动文件 `eslint` **0** · `lint:arch` **违规 0 / 警告 4（基线）· 重复实现 0** · `lint:size` **0 错 / 470 警告 / 8 例外** · 全量 `bun test` **507 files / 4774 pass / 21 skip / 0 fail**（+1 文件 / +11 例，逐数吻合）。

**遗留（明确）**：§9.4（排队，D7=b）**仍未落地**；`preempted` 标记目前**仅治理器内部 + 日志**，**未下发** UI/SSE ⇒ "用户可见区分"仍缺（= 台账 §27.3 **PC-2**）。

#### 9.9.3 步骤 4（§9.4 **超限排队 + 超时告警放行**，D7=b / **D12=a 告警+放行** / D13=a 共用开关）—— 🟢 **已落地 2026-10-07**

**落点（实测回仓）**

| # | 落点 | 改动 |
|:--:|---|---|
| 1 | `resourceGovernor/types.ts` | 新增 `QueueOptions { timeoutMs? }` |
| 2 | `resourceGovernor/index.ts` | 新增常量 `DEFAULT_QUEUE_TIMEOUT_MS = 30_000`（对齐 `SimpleMutex` 口径）+ 内部 `QueueWaiter`；**新增 `acquire(req, {timeoutMs})`**（准入 + 超限无可抢占 ⇒ 入队等待；**超时 = 告警 + 放行**）、`queueLength()`（观测）、私有 `enqueue`/`wakeOneWaiter`/`removeWaiter`；`release()` **移除即移交一个名额**（1:1 交接）；`reset()` 连带**结算并清空**等待者（防测试悬挂） |
| 3 | `chat/orchestrator/streamMessageFlow.ts`（准入点 ①） | `admit(` → **`await acquire(`** |
| 4 | `chat/orchestrator/ChatOrchestrator.ts`（准入点 ②，非流式） | 同上 |
| 5 | `app/tests/resourceGovernor/queueing.test.ts` | **新建（6 例）**：未超限不排队 / 超限挂起 + `release()` 唤醒 / **唤醒按优先级降序**（bg 先入队、ui 后入队先醒）/ **超时告警放行**（耗时断言 + 队列归零）/ 同会话幂等不重复入队 / **开关关闭零变更** |

**语义细节（如实）**
- **排队期间该会话已在 `admit()` 中登记为在飞**（既有准入契约不变 ⇒ `snapshot()` 含之）；唤醒机制 = `release()` 逐次移交（不按名额批量放行）。
- **超时回落 = 告警 + 放行**（D12）⇒ **不引入拒绝路径**，`admitted` 仍恒 `true`（D4 未变）。
- **不复用 `ResourceScheduler`**：实测其为同步非阻塞（无 await / 无超时）⇒ 新建极小等待原语，**口径对齐**（优先级降序 + FIFO）而非复制类（§9.4 取证段）。
- 开关**共用** `FEATURE_RESOURCE_GOVERNOR`（D13）⇒ 默认关时排队亦不生效。

**门禁（全绿）**：`typecheck` **0** · 改动文件 `eslint` **0** · `lint:arch` **违规 0 / 警告 4（基线）** · `lint:size` **0 错 / 470 警告 / 8 例外** · 全量 `bun test` **508 files / 4780 pass / 21 skip / 0 fail**（+1 文件 / +6 例，逐数吻合）。

**阶段 2 完成度**：§9.1 ✅ · §9.2 ✅ · §9.4 ✅ · §9.3（C 案）按裁定**不做**。

#### 9.9.4 前端配套（**PC-2** 抢占/排队状态下发，用户裁定「通知 SSE」）—— 🟢 **已落地 2026-10-07**

**背景（= 台账 §27.3-PC-2）**：D6=B 的抢占复用 `abortSessionStream`（**不落检查点**）⇒ 被抢占会话
的可见回复被丢弃；`InFlightEntry.preempted` 此前**仅落日志**，前端无法区分"**被更高优先级任务抢占**"
与"**用户自己中止**"。用户裁定下发通道 = **通知 SSE**（同 `system:estop_changed` / `system:sleep_detected` 族）。

**落点（实测回仓）**

| # | 落点 | 改动 |
|:--:|---|---|
| 1 | `resourceGovernor/types.ts` | 新增 `GovernanceState`（`preempted｜queued｜released`）· `GovernanceEvent { sessionId, state, queuePosition? }` · `GovernanceObserver`；`ResourceGovernorOptions` 增 `onEvent?`（**CS02：结构化枚举，非文案匹配**） |
| 2 | `resourceGovernor/liveEvents.ts` | **新建**：`RESOURCE_GOVERNOR_SSE_EVENT = 'system:resource_governor'` + `buildResourceGovernorPayload()`（JSON 安全，省略 `undefined`）+ `emitResourceGovernorEvent()`（**懒加载** `@modules/infrastructure#broadcastEvent`，失败不下发不影响治理决策） |
| 3 | `resourceGovernor/index.ts` | 类增 `onEvent` 字段 + `setEventObserver()`；**四个下发点**：抢占（`preempted`）· 入队（`queued` + `queuePosition`）· `wakeOneWaiter()` 移交（`released`）· 排队超时放行（`released`）；新增全局注入 `setResourceGovernorObserver()`；`index.ts` **转出** `liveEvents` 三符号 |
| 4 | `bootstrap/pipeline/BootPipelineIntegrator.ts` | **组合根装配**：`setResourceGovernorObserver(emitResourceGovernorEvent)`（治理器零传输依赖，同 `setResourceGovernorPreemptHandler` 注入缝） |
| 5 | `client/src/stores/resourceGovernorStore.ts` | **新建**：按会话记录 `{ state, queuePosition?, at }`；`released` ⇒ **删除**条目；非法载荷忽略 |
| 6 | `client/src/hooks/useNotificationSSE.ts` | 订阅 `sseService.on('system:resource_governor')` → store（**复用既有单一事件源**，不自建 `EventSource`，遵 TB-5） |
| 7 | `client/src/components/ChatArea/ResourceGovernanceNoticeBar.tsx` | **新建**：会话级提示条（`preempted` 琥珀色 + 可关闭；`queued` 天蓝色），挂 `ChatArea` 底部区（同 `YieldNoticeBar` 形态） |
| 8 | `client/src/i18n/locales/{zh,en}.ts` | `chat.preemptedNotice` / `chat.queuedNotice`（**双语同批**，PC-4；文案**去技术化**，PC-5） |
| 9 | `app/tests/resourceGovernor/liveEvents.test.ts` | **新建（2 例）**：事件名逐字契约（跨端）+ 载荷 JSON 安全 |
| 10 | `app/tests/resourceGovernor/{preemption,queueing}.test.ts` | 各 +3 例：抢占下发 / 入队+移交下发 / 超时放行下发 / 开关关不下发 |
| 11 | `client/src/tests/resourceGovernorStore.test.ts` | **新建（4 例）**：记录 / `released` 清除 / 非法载荷忽略 / `clear` 幂等 |

**语义细节（如实）**
- **victim 恒为 `background` 会话**（`selectPreemptionVictim` 只选优先级**严格更低**者，而枚举仅 `background < interactive`）⇒ 「被抢占」提示条主要面向**后台/渠道会话**；人工对话不会被抢占（§9.8-1「后台不挤占人工」）。
- **`released` 双语义**：名额移交 与 排队**超时放行**（D12）——两者都意味着"已不再排队"，前端一律**清除**提示（避免"排队中"永久残留）。
- **仅前端提示，不改数据面**：不下发任何"模型可见输入"⇒ **不触发** §1.6「模型可见 ⇔ 已落盘」红线（无需新增会话事件）。
- 开关**共用** `FEATURE_RESOURCE_GOVERNOR`（D13）⇒ 默认关时四类事件**均不产生**（实测守卫已锁）。

**门禁（全绿）**：`typecheck`（app + client）**0** · 改动文件 `eslint` **0** · `lint:arch` **违规 0 / 警告 4（基线）** · `lint:size` **0 错 / 470 警告 / 8 例外** · `lint:doc-code` **18 断言一致** · 全量 `bun test`（app）**509 files / 4791 pass / 21 skip / 0 fail** · `vitest`（client）**59 files / 518 pass**。

**阶段 2 完成度（更新）**：§9.1 ✅ · §9.2 ✅ · §9.4 ✅ · §9.3（C 案）按裁定**不做** · **前端配套 PC-2 ✅**。
**不再开放**：原"`preempted` / 排队状态未下发 UI/SSE"已由本节关闭。

