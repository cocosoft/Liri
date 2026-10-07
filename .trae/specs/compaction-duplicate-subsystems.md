# 压缩子系统重复并存 —— 核查立项

> 版本 1.1 ｜ 创建 2026-09-28 ｜ 核查 2026-09-28 ｜ 状态：**已核查 —— 结论：两套是「分工」非双轨（不下线）；后续动作为「重命名 + 边界互指声明」**
> 来源：[`liri-optimization-plan-20260926.md`](./liri-optimization-plan-20260926.md) 的 **P1-3** 取证时发现（用户裁定"立项核查"）。
> 台账登记：`dev_docs/error_repairs/预存错误与待处理问题.md` **D-6-c**。
> **路径变更（2026-10-01 D-217）**：B 侧 `services/compact/` 已**改归 app 层**至 `compaction/`（分层倒挂治理，见 [`layer-inversion-service-app-app-ui.md`](./layer-inversion-service-app-app-ui.md) §3.5 D-217）；本文件内路径已同步更新，`services/compact` 仅作历史沿革指代。

## 1. Problem Statement

仓内存在**两套上下文压缩子系统**，且**两者都有活消费者**（非"一套活、一套死"）：

| 子系统 | 规模 | 已核到的活消费者 |
|---|---|---|
| [`app/src/compaction/`](../app/src/compaction) | **23 个文件** | `chat/ChatManager.ts:327`、`chat/services/ContextCompactor.ts:33`、`query/ContextCollapse.ts:9`、`query/ReactiveCompact.ts:12`、`session/compaction/ServiceAdapters.ts:1`、`commands/builtin/compact/Compact.ts:15` |
| [`app/src/context/compaction/`](../app/src/context/compaction) | 7 个文件 | `@modules/context` 的 `compactionOrchestrator`（被 `chat` / `query` 消费） |

**命名几乎一一对应**，这本身就是"同义重复实现"的强信号：

- `compaction/CompactOrchestrator` ⟷ `context/compaction/CompactionOrchestrator`
- `compaction/microCompact` ⟷ `context/compaction/MicroCompactionEngine`
- `compaction/strategies/SnipCompactStrategy` ⟷ `context/compaction/SnipEngine`

且**阈值口径也分两套**：`compaction` 用**绝对 buffer**（有效窗口 − 13000 等），`context/compaction` 用**比例**（`UNIFIED_THRESHOLDS` 0.85 / 0.92）。

**为什么必须查清**：`architecture.md` 的「**实现唯一性原则（双轨制禁止）**」要求同一语义只有一份实现。若两套在**同一场景**都会被触发，则触发时机/产物/落盘可能不一致（用户观感与轨迹视图失真）；若它们**分工不同**（如一套管"会话级/命令级"、一套管"上下文窗口"），则应在文档与命名上**显式划界**，而非让读者靠猜。

## 2. 待核问题（核查目标）

1. **职责边界**：两套各自负责什么？在什么入口被触发？
2. **能力是否重叠**：是否存在"同一场景两条路径都能压"？若有 ⇒ 真实链路上**谁先生效**、另一条是否被短路？
3. **是否构成双轨**（同义重复实现）⇒ 按「实现唯一性」**是否应下线一套**？
4. **若应下线**：下线哪一套？**消费者 → 替代路径 → 验证方式**逐条列出。
5. **阈值口径**：无论是否下线，**绝对 buffer** 与**比例阈值**要不要在同一登记面（`BudgetPolicy`）下显式化？
   （现状：`context` 侧已由 `budget-policy-layer.md` §6.5 登记；`compaction` 侧未登记 ⇒ **D-6-b**）

## 3. 验收判据

- 给出两套的**调用链图**（入口 → 触发条件 → 执行 → 产物落盘），**每条边附代码位置（文件:行）**；
- 明确回答"**是否双轨**"，并给出**可证伪**的依据 —— 优先**运行期证据**（日志/轨迹中同一轮出现两条压缩路径），而非仅静态阅读；
- 若判定应下线 ⇒ 给出**迁移清单**（消费者 → 替代路径 → 验证方式）与**回滚点**；
- **核查阶段不得改动任何执行路径**（本节是本 spec 的硬约束）。

## 4. 非目标（明确不做）

- **不**合并两套实现、**不**改任何阈值数值、**不**下线任何代码 —— 本轮只产出**核查结论与迁移方案**。
- **不**涉及 `context/` 下与压缩无关的模块（`ContextInjector` / `ContextIsolator` / `ContextSharingManager` 等）。
- **不**处理 `compaction/utils.ts` 里那处**死代码算式反向**（`getWarningThreshold` / `getErrorThreshold`，见 D-6-d）—— 因为若整体下线，改它无意义；**留待本 spec 结论后一并处置**。

## 5. 影响面（预计）

- **核查阶段：零代码改动**（纯读 + 运行期观察）。
- 若进入下线阶段，影响 `chat` / `query` / `session/compaction` / `commands/builtin/compact` **四处消费面**。

## 6. 合规检查清单（GR 对照）

| 规则 | 本 spec 的落点 |
|---|---|
| GR01 归一化（新增前先查已有） | 核查**先于**任何合并/新增；结论若为"保留两套"须给出显式划界依据 |
| GR02 实现唯一性（双轨制禁止） | **本 spec 的核心判据**（问题 3） |
| GR03 证据驱动 | 判据要求"每条边附文件:行"+"优先运行期证据" |
| GR04 Mock 零容忍 | 不适用（无数据产出） |
| GR05 根因优先 | 结论须回答"为何会长出两套"（而非只描述现状） |

## 7. 核查结论（2026-09-28，**静态**取证）

**判定：两套是「分工」，不是同义双轨 ⇒ 不下线任何一套。**

| 维度 | **A：`context/compaction/`** | **B：`compaction/`** |
|---|---|---|
| **触发时机** | **自动**：对话请求前（`StreamPipeline:299,364`、`streamMessageFlow:401`、`sendMessageFlow:412`）+ **工具轮内**（`ReActToolLoop:602,678`）+ `QueryEngine:1261`（`compactIfNeeded`） | **手动 / 生命周期边界**：`/compact` 命令（`commands/builtin/compact/Compact.ts:55`）、HTTP 端点（`session-handlers.ts:1017` → `CoreAPIImpl:2658` → `ChatManager:6837`）、会话边界（`SessionGateway:1974` / `SessionManager:405` 的 `beforeCompact`） |
| **阈值口径** | 比例（`UNIFIED_THRESHOLDS`） | 原为**绝对 buffer** ⇒ **本次 P1-3-c 已统一为比例** |
| **独有能力** | 分层折 / 压缩级评估 / `context/compaction` 事件 | `CompactArtifact[]` + **`reinjectArtifacts`（产物回收再注入）** |

**判据（可复核）**：两条调用链**静态无交集** —— A 全部落在「对话请求 / 工具轮」路径；B 全部落在「命令 / HTTP / 会话边界」路径。且 B 的 `/compact` 与 HTTP 端点**语义即"用户显式要求压缩"**，A 是"系统按阈值自动压缩" ⇒ **不是同一场景两条都跑**（不是双轨；只是"两道闸"，且二者阈值已在 P1-3-c 统一）。

**✅ 运行期证据已补（2026-10-04）**：① **事件级**：全部会话 `context/compaction` 共 **44 个**（turn 内 23 / turn 外 21），但**写出方唯一**（仅 `streamMessageFlow` 2 处）⇒ 该事件只代表路径 A；长会话 11 个压缩事件**全在 turn 内**，同轮两次（`seq 10575`/`10582`）是**同子系统顺序压两段不同区间**，非两条路径。② **日志级（最有力）**：`app.log` 中路径 A `context:compaction:orchestrator` **205 次**、路径 B `services:compact` **0 次** ⇒ **运行期从未出现"两条路径同轮"**。⇒ 上述静态结论**获运行期证据支持**（分工非双轨）。**边界**：未执行 `/compact` / HTTP 压缩端点以**主动触发 B**（会真实压缩用户会话）。详见台账 V-1。

**✅ 路径 B 已主动触发（2026-10-07，V-1 残余收口；临时会话，用后删除）**：`POST /v1/sessions`（新建）→ 经 `POST /v1/sessions/:id/messages` 注入 4 轮问答 → `POST /v1/sessions/:id/compact` ⇒ **返回 `success:true` + 真实 `CompactArtifact`**（`type:"summary"`，正文 `Session Summary: Round 1..5`，`references:[u1,a1,u2,a2,u3,a3,u4,a4]`）⇒ **路径 B（手动/端点）在本机真实压缩成功**。**同刻未出现路径 A**：`app.log` 中 `context:compaction:orchestrator` 仅命中**其它历史会话**（06:24，`session_muxpyui38aqmnf2hom4`），**该会话零命中** ⇒ 运行期**确认"两道闸不共跑"**。观测到 `session:compacted` SSE 广播（`http:local`）。**附带如实**：`services:compact` 模块在 `app.log` **全仓 0 命中** ⇒ 路径 B 的**日志可观测性偏弱**（仅广播，无模块级 info）——非缺陷，登记备查。临时会话已 `batch-delete`（`deleted:2`/`failed:0`）。

**仍存在的真实问题（应处置，但不是"下线"）**：
1. **命名高度混淆**：`CompactOrchestrator` ⟷ `CompactionOrchestrator`、`microCompact` ⟷ `MicroCompactionEngine`、`SnipCompactStrategy` ⟷ `SnipEngine` ⇒ 建议**按职责重命名**（如 B 侧统一加 `Manual` / `Session` 前缀），使读者一眼可辨；
2. **边界未显式声明**：两者都能"把消息压成摘要"，目前**只靠触发时机区分**，模块头注释未声明分工 ⇒ 建议**两处模块头注释互指**；
3. **`compaction` 未纳入 `BudgetPolicy` 登记面**（P1-3 的 d 项）：因 c 统一比例后已非"两套口径"，但**登记**仍缺 ⇒ 可后续并入。

**后续动作（2026-09-28 复核后修正）**：

1. ✅ **边界互指声明 —— 已落地**：A 侧 [`context/compaction/CompactionOrchestrator.ts`](../app/src/context/compaction/CompactionOrchestrator.ts) 头注释、B 侧 [`compaction/AutoCompactService.ts`](../app/src/compaction/AutoCompactService.ts) 顶部注释，**各含**"分工 + 互指 + 改动前先读本 §7"（两处均为**活的门面**：前者在主链路、后者在会话级路径）。

2. ✅ **「重命名」经取证修正为「删除死代码」—— 已执行（2026-09-28，用户裁定方案 A）**：
   - 已删 [`compaction/CompactOrchestrator.ts`](../app/src/compaction/CompactOrchestrator.ts)（**仅桶导出**）与
     [`compaction/strategies/SnipCompactStrategy.ts`](../app/src/compaction/strategies/SnipCompactStrategy.ts)（**完全孤立**，连桶导出都没有）；
   - 同步清理 [`index.ts`](../app/src/compaction/index.ts) 的 **3 项导出**（`CompactOrchestrator` / `CompactRecord` / `CompactOrchestratorOptions`）；
   - **验收**：`typecheck` **0**（⇒ 证实这 3 个导出**确无外部消费者**，删除安全）· `eslint` **0** · `prettier` ✓ · 相关 4 测试 **21 pass / 0 fail** · `lint:arch` **0 错 1 警**（**检查文件 3681 → 3679**、**豁免 396 → 395**，与删除 2 文件一致；**未新增违规**）。

   · ~~保留不动~~：[`microCompact.ts`](../app/src/compaction/microCompact.ts) 当时判为"**部分活**"（`resetMicrocompactState` 经 `postCompactCleanup` 被调）—— 但该调用只是"**重置微压缩自身状态**"，随微压缩整体死亡即失去意义 ⇒ **已在下条一并清理**。
   · ✅ **随之而来的孤儿链已一并清理（2026-09-28，用户指令）**：`microCompact.ts` 的 `microcompactMessages` 只是**入口** —— 其下游 `evaluateTimeBasedTrigger` / `TIME_BASED_MC_CLEARED_MESSAGE` / `MicrocompactResult` / `PendingCacheEdits` 与全部私有工具函数**互链且无外部消费者**；而 `timeBasedMCConfig.ts` 的**唯一消费者**就是 `microCompact.ts` ⇒ 该链条等价于**整模块死亡**。故一并处理：
   - **删** `microCompact.ts` + `timeBasedMCConfig.ts`（**2 个文件**）；
   - 清理 [`index.ts`](../app/src/compaction/index.ts) 的 **7 项导出**（`microcompactMessages` / `evaluateTimeBasedTrigger` / `TIME_BASED_MC_CLEARED_MESSAGE` / `resetMicrocompactState` / `MicrocompactResult` / `PendingCacheEdits` / `getTimeBasedMCConfig` + `TimeBasedMCConfig`）；
   - 移除 [`postCompactCleanup.ts`](../app/src/compaction/postCompactCleanup.ts) 对 `resetMicrocompactState()` 的调用（微压缩已不存在 ⇒ **无状态可重置**；理由已写入该文件注释，并更正其原先"不删除现有代码"的措辞）。
   - **验收**：`typecheck` **0** · `eslint` **0** · `prettier` ✓ · 相关 4 测试 **21 pass / 0 fail** · `lint:arch` **0 错 1 警**（**检查文件 3679 → 3677**，与再删 2 文件一致）。

3. ⏳ **`compaction` 纳入 `BudgetPolicy` 登记面** —— 未做（因 P1-3-c 已统一比例，优先级下降）。
