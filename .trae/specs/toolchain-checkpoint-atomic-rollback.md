# 工具链级 checkpoint + 原子回滚 —— 立项与能力边界核查

> **状态**：⛔ **不实施（前置取证后裁定：能力已具备）** —— 2026-09-29 补做 §3 前置时发现**第三块拼图**：仓内**已有一套「轮粒度 checkpoint + 工具级文件追踪 + undo/redo」系统**（`security/rollback/`，**已接线**，见 §1.3）⇒ 原方案诉求**基本已实现**；剩余只是**运维问题**（快照 4.4GB 无淘汰）与**一处台账旧结论更正**（§2）
> **来源**：[`liri-upgrade-plan-20260928.md`](./liri-upgrade-plan-20260928.md) §2.F **F4** / §2.G **G4** / §3 **P3-2**
> **关联规则**：GR01（基础设施复用）/ GR02（实现唯一性）/ GR03（证据驱动）/ CS01（新增前先查已有）/ CS03（回退最小化）/ CS05（根因优先）/ §1.6（Write-Ahead Persistence）
> **最后更新**：2026-09-29

---

## 1. 取证：已有能力（先证"已经有了什么"）

### 1.1 ✅ **会话/工具链级** checkpoint —— **已存在且已接线**

[`chat/services/StreamingAutoCheckpoint.ts:5-12`](../../app/src/chat/services/StreamingAutoCheckpoint.ts#L5-L12) 头注释原文：

> 「P2-1: **在 ChatManager 工具循环的每个 `tool_call` 完成后自动写入检查点**，支持**增量存储**（每 10 步一次全量）和**生成器状态恢复**。复用已有的 `SessionCheckpointService` + `CheckpointDatabase`（SQLite 持久化）」

- **活消费者（已核到行）**：[`chat/ChatManager.ts:3980`](../../app/src/chat/ChatManager.ts#L3980) / [`:5244`](../../app/src/chat/ChatManager.ts#L5244)（构造与 `restore()`）、[`chat/orchestrator/streamMessageFlow.ts:42`](../../app/src/chat/orchestrator/streamMessageFlow.ts#L42)、[`chat/orchestrator/ChatOrchestrator.ts:295`](../../app/src/chat/orchestrator/ChatOrchestrator.ts#L295)。
- **恢复态**含：`newMessagesSinceLastCheckpoint` / `messagesSnapshot` / `currentToolCalls` / `completedToolCallIds` / `generatorState{toolTurnCount, llmCallCount}`（[:27-48](../../app/src/chat/services/StreamingAutoCheckpoint.ts#L27-L48)）。
- **会话级契约**：[`chat/types/checkpoint.ts:4-15`](../../app/src/chat/types/checkpoint.ts#L4-L15) 的 `SessionCheckpoint` = **`messages` + `metadata` + `state`**（**不含文件系统**）；`CheckpointService.rollbackToCheckpoint()`（[:49-61](../../app/src/chat/types/checkpoint.ts#L49-L61)）；表 `session_checkpoints`（[:73](../../app/src/chat/types/checkpoint.ts#L73)），`CHECKPOINT_MAX_AUTO = 50`（[:72](../../app/src/chat/types/checkpoint.ts#L72)）。
- **互补件**：[`chat/services/PlainTextCheckpoint.ts:11`](../../app/src/chat/services/PlainTextCheckpoint.ts#L11)（"与 `StreamingAutoCheckpoint`（工具调用路径）互补，覆盖全部对话场景"）。

⇒ **结论**：`liri-upgrade-plan-20260928.md` §3 P3-2 里"① 复用既有能力做**工具链级自动 checkpoint**"—— **在"会话状态"这一半上，本仓已经做到，且粒度就是"每个 tool_call 完成后"**。

### 1.2 ⚠️ **文件系统级** checkpoint —— 存在，但**仅限隔离 worktree**，且是**破坏性**的

[`workspaces/apply/WorkspaceSnapshot.ts`](../../app/src/workspaces/apply/WorkspaceSnapshot.ts)：

- `createWorkspaceSnapshot()`（[:61-98](../../app/src/workspaces/apply/WorkspaceSnapshot.ts#L61-L98)）= `git add -A` + `git commit -m "snapshot: {label}"`；头注释（[:11-12](../../app/src/workspaces/apply/WorkspaceSnapshot.ts#L11-L12)）明写"快照 commit **落在当前分支（隔离 worktree 分支）**，不污染主分支"。
- `restoreWorkspaceSnapshot()`（[:100-113](../../app/src/workspaces/apply/WorkspaceSnapshot.ts#L100-L113)）= **`git reset --hard {hash}`**（注释：丢弃快照后的全部改动）。
- **唯一消费者** = [`workspaces/AutonomousRunner.ts:71`](../../app/src/workspaces/AutonomousRunner.ts#L71) / [`:131`](../../app/src/workspaces/AutonomousRunner.ts#L131)（自主运行 / apply-back 失败时的隔离区回滚）。全仓 grep 仅此一处。

⇒ **结论**：文件系统级快照**确实存在**，但它 (a) 语义是"**在隔离 worktree 里**自行提交"；(b) 回滚是 `reset --hard`（**丢改动**）。

### 1.3 ✅ **第三块拼图（2026-09-29 补，决定性）—— 轮粒度快照 + 工具级文件追踪 + undo/redo：已实现且已接线**

`security/rollback/`（**10 文件**：`FileOperationTracker` / `SnapshotStorage` / `UndoManager` / `RedoManager` / `RollbackIntegration` / `CleanupManager` / `AIContextInjector` / `xxHash` / `types` / `index`）：

| 能力 | 证据 |
|---|---|
| **轮粒度快照** | [`RollbackIntegration.ts:28-39`](../../app/src/security/rollback/RollbackIntegration.ts#L28-L39) 的生命周期注释：`onRoundStart()` → `FileOperationTracker.recordRoundStart()`；`onRoundEnd()` → `detectShellSideEffects` + `SnapshotStorage.createRoundSnapshot()` + `updateSessionIndex()` |
| **工具级文件操作追踪（即"工具链级"）** | `onToolBeforeExecute()`（**每工具调用**）→ `FileOperationTracker.beforeToolOperation()`；调用点 [`ToolExecutionService.ts:602-620`](../../app/src/chat/services/ToolExecutionService.ts#L602-L620)（`file_write` / `file_edit` 执行**前**登记 `{path, type:'modified'}`） |
| **undo / redo** | `UndoManager.executeUndo` / `previewUndo` / **`findDependentRounds`（依赖轮查找）**；`RedoManager.executeRedo` / `canRedo`（**redo 冲突检测**） |
| **AI 上下文注入** | `AIContextInjector.generateUndoContext` / `shouldInjectContext` |
| **启动清理** | `CleanupManager.onApplicationStart`，调用点 [`ChatManager.ts:2786`](../../app/src/chat/ChatManager.ts#L2786) |
| **接线（每会话一实例）** | [`ChatManager.ts:751`](../../app/src/chat/ChatManager.ts#L751) `rollbackIntegrations: Map<string, RollbackIntegration>`；`_getRollbackIntegration()`（[:5679-5702](../../app/src/chat/ChatManager.ts#L5679-L5702)）；注入 [`ToolExecutionService.ts:188`](../../app/src/chat/services/ToolExecutionService.ts#L188) |
| **常量口径正确（关键）** | `FILE_WRITE_TOOL_NAME = 'file_write'` / `FILE_EDIT_TOOL_NAME = 'file_edit'`（[`constants/tools.ts:31-32`](../../app/src/constants/tools.ts#L31-L32)）—— **就是真实注册名** ⇒ `ToolExecutionService.ts:604-605` 的等值比较**成立**、追踪**会触发** |

⇒ **结论**：F4 / P3-2 所要求的"**工具链级自动 checkpoint + 原子回滚**"，在本仓**已经存在并已接线**，粒度是**轮（round）** + **每工具调用前**。

---

## 2. 真正的缺口（含对原方案的**两处纠正**）

| 原方案表述 | 实测 | 纠正 |
|---|---|---|
| 「缺"**工具链级**自动 checkpoint + 失败原子回滚"」（§2.F F4） | **已具备**（§1.3）—— `security/rollback/` 的**轮快照 + 工具级文件追踪 + undo/redo** 已接线 | ⇒ 缺的**不是该能力**；见 §1.3 与下方"剩余真实问题" |

**⇒ 真实结论（一句话，2026-09-29 更正）**：**"工具链级 checkpoint + 原子回滚"在本仓已具备**（§1.3），原方案的"缺口"判定**不成立**。

**剩余真实问题（都不是"缺能力"，而是运维/账目）**：

1. **快照存储治理** —— ⚠️ **原表述需收窄（2026-09-29 取证更正）**：配额淘汰**已存在**（[`enforceSnapshotQuota()`](../../app/src/security/rollback/CleanupManager.ts#L181-L272)：**5 GB + 最旧优先 + 边界保护**，且经 `onApplicationStart()` 在启动时执行；实测 `data/snapshots` = **527 文件 / 5007 MB**、**未超限** ⇒ 属设计内驻留）；真正缺的是 **①"未超限 ⇒ 零输出"（可观测性）**、② `tmp/` 不计入配额口径、③ 同目录多写者（`performance/MemorySnapshotService` 也用 `data/snapshots`）。⇒ ✅ **已另立 spec 并完成 ① 的补强**：[`snapshot-storage-governance.md`](./snapshot-storage-governance.md)（2026-09-29；②/③ 决定"不改/只登记"，理由见该 spec §2）。
2. **一处台账旧结论与现状不符（需更正）**：台账曾记「[`ToolExecutionService.ts:602-606`] 用这两个常量判定…比较**恒不成立** ⇒ 回滚的文件操作前追踪**从未触发**」—— 实测**不成立**：这两个常量（[`constants/tools.ts:31-32`](../../app/src/constants/tools.ts#L31-L32)）**就是真实名** `file_write` / `file_edit` ⇒ 比较**成立**、追踪**会触发**。已登记为 **D-18**（更正 + 保留原文可追溯）。

---

## 3. 前置条件（2026-09-29 取证后：**能力已具备 ⇒ 无开工依据**）

| 前置 | 状态 | 说明 |
|---|:--:|---|
| **真实失败案例** | ❌ **未取数** | 需先有"多步工具链中途失败、且**会话回滚不够、必须回滚文件**"的**实测案例**。**当前无** ⇒ 直接违反 CS03（不为理论可能性加机制） |
| **安全边界设计** | ❌ **未做** | 必须回答：在**用户真实仓库**里能否动 `git`？若能，如何保证"**不丢用户已有改动**"（`reset --hard` 会丢）？若不能，快照介质是什么（临时目录副本 / `git stash` / 隔离 worktree）？ |
| **成本评估** | ✅ **已测（2026-09-29）** | 仓库 **5,718** 个 tracked 文件（`REF/` 被 gitignore 跳过）下，`git add -A`（**`-n` dry-run**，无副作用）**157.6 ms**、`git status --porcelain` **159.6 ms** ⇒ 单次全仓 add ≈ **0.16 s**。**⚠️ 但这项已随 §1.3 的发现降级为"不必评估"** —— 已具备的方案**不走 git**（`SnapshotStorage` 是自有快照），无需按步跑 `git add` |
| **与 §1.6 Write-Ahead 的关系** | ❌ **未定** | 会话侧已按 §1.6 做"关键节点即时落盘"；工作区侧若也做 checkpoint，需明确**两者的失败恢复顺序**（避免"会话回到前一步、文件已改"的不一致态） |

---

## 4. 候选形态（待前置满足后再裁）

| 形态 | 内容 | 成本 | 风险 |
|---|---|---|---|
| **A 隔离 worktree 前置** | 只在**已有隔离 worktree** 的链路（`AutonomousRunner` 一类）扩展 checkpoint 粒度 —— 即**确认无需新增**，只补文档 | **最小** | 零 |
| **B 对话链路上的"轻量文件快照"** | 工具链开始前把**受影响的文件**复制到 `~/.pyapp/snapshots/`（**不碰用户 git**），失败时按需恢复 | 中 | 中（"受影响文件"的判定 + 恢复可能覆盖用户之后的编辑） |
| **C 全量 git 快照进对话链路** | 在真实仓库执行 `git add -A/commit` + `reset --hard` | 中 | **高（会污染/丢用户改动）** ⇒ **不推荐** |
| **D 暂缓** | 会话级已有（§1.1）；文件系统级待真实案例 | 零 | 零 |

- **裁定（2026-09-29，前置取证后）**：**D 暂缓 —— 并撤销本 spec 的"待做"定位**。理由：① 能力**已在位**（§1.3：轮快照 + 工具级追踪 + undo/redo，已接线）⇒ A/B/C 三项均属**重造已有能力**（违 CS01 / GR01 / GR02）；② §3 的"真实失败案例"**仍无数据**（`app.log` 中 apply-back / rollback 相关**零命中**），无依据支撑新机制。
- **若仍要继续该主题**：应改做 **`snapshots/` 的存储淘汰**（§2 剩余真实问题 1，4.4 GB 无上限）—— 那是**存储治理**，**另立 spec**，与本 spec 的"新增工具链快照"**不是同一件事**。

---

## 5. 合规检查表

| 规则 | 落实 |
|---|---|
| GR01（基础设施复用） | §1 逐项核了既有能力（`StreamingAutoCheckpoint` / `SessionCheckpointService` / `WorkspaceSnapshot`）⇒ **结论是"一半已具备"**，避免重造 |
| GR02（实现唯一性） | ⚠️ **风险点**：若新增文件系统级 checkpoint，**必须**与 `WorkspaceSnapshot` 划清边界（谁在 worktree 内、谁在真实仓库），否则形成两套"快照"语义 |
| GR03（证据驱动） | §1 每条附 `文件:行`；§3 明写四项前置**均未做** ⇒ **不据此开工** |
| CS01（新增前先查已有） | §1 即该检查；**未**新造第二套 checkpoint 服务 |
| CS03（回退最小化） | 本 spec **不新增**任何回退路径；形态 A/D 的成本趋零 |
| CS05（根因优先） | 根因待定：**是"缺文件级 checkpoint"还是"缺失败案例"** —— §3 第一行正是为分清这一点 |
| §1.6（Write-Ahead） | §3 第四行：若要做，须先定"会话 checkpoint 与文件 checkpoint 的失败恢复顺序" |

---

## 6. 不在范围 / 未验（如实）

- ❌ **不改** `StreamingAutoCheckpoint` / `SessionCheckpointService`（§1.1 已达标）。
- ❌ **不改** `WorkspaceSnapshot` 的既有语义（`AutonomousRunner` 依赖它）。
- ❌ **不做** "每步工具调用前全仓 `git` 快照"（成本未测 + 安全未定）。
- ⚠️ **未验**：① 真实失败案例（§3 第一行）；② `spawn git add -A` 在**大仓**的耗时基线；③ `autonomous/apply-back` 之外是否还有别的隔离 worktree 链路可挂（本轮只核到 `AutonomousRunner` 一处）。
