# 消息回退与文件回滚系统桥接方案

> 日期: 2026-07-24 | 状态: 待评审
> 关联文档: [message-delete-rollback-design.md](./message-delete-rollback-design.md)
> 关联系统: `security/rollback/`（对话级文件回滚引擎）

## 1. 问题陈述

原「消息删除/回退」方案（`message-delete-rollback-design.md`）只考虑了消息记录的删除，**完全没有涉及 AI 执行过的副作用操作的回退**。

每次用户和 AI 的交互中，AI 可能执行了文件创建/修改/删除、进程调用、API 调用等操作。回退一条消息时，**消息可以删，但文件系统和其他外部状态也需要同步回退**——否则用户回退后，文件系统处于"改了但消息没了"的不一致状态。

好消息是：项目**已经有了一套完整的文件级回滚引擎**（`security/rollback`），支持：
- 文件操作追踪（显式工具调用 + Shell 副作用检测）
- 快照管理（manifest + 备份文件，存储在 `~/.pyapp/data/snapshots/`）
- 撤消执行（WAL 崩溃恢复 + UndoGuard + 用户修改检测 + 级联撤消）
- 重做执行

**问题在于：消息系统与回滚系统是两套独立体系，没有关联索引。**

---

## 2. 核心数据模型：Round ↔ Message 桥接

### 2.1 概念对齐

| 消息系统 | 回滚系统 |
|---------|---------|
| `sessionId` + `messageId` | `sessionId` + `roundId` |
| 每条消息有 role、content | 每轮快照含 changedFiles、userMessageSummary |
| 消息顺序 = `createdAt` 升序 | 轮次编号 = `roundId` 递增 |
| 回退到 message M | 撤消 round > roundOf(M) 的所有轮 |

**需要桥接**：在消息和轮次之间建立显式映射。

### 2.2 RoundIndex 数据结构

新增 `session.metadata.roundIndex`，存储消息 ID 到轮次编号的映射：

```typescript
// 在 shared/types/message.ts 或 session 类型中
interface SessionMetadata {
  // ... 现有字段

  /** 消息 ID → 轮次编号 的映射 */
  roundIndex: Record<string, number>;
}
```

**填充时机**：在 `ChatManager.streamMessage()` 中，当创建用户消息时：

```typescript
// ChatManager.ts — streamMessage() 内部
// 第1步：先创建用户消息（获取 messageId）
const userMessage = await this.createMessage(sessionId, {
  role: 'user', content
});

// 第2步：调用 RollbackIntegration 开始一轮
const rollbackIntegration = new RollbackIntegration(sessionId);
await rollbackIntegration.onRoundStart(
  sessionId,
  currentRoundId,            // 从 session.metadata.roundCounter 读取
  [workspacePath]
);

// 第3步：记录 messageId ↔ roundId 映射
session.metadata.roundIndex[userMessage.id] = currentRoundId;
session.metadata.roundCounter = (session.metadata.roundCounter ?? 0) + 1;

// 第4步：AI执行工具调用（每调用前记录）
// tools/write.ts, edit.ts, delete.ts 等
await rollbackIntegration.onToolBeforeExecute({
  path, type, backupPath, ...
});

// 第步：AI 回复完成后，结束本轮
const snapshot = await rollbackIntegration.onRoundEnd(
  userMessage.content  // 作为 userMessageSummary
);
```

### 2.3 新增字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `session.metadata.roundIndex` | `Record<string, number>` | messageId → roundId 映射 |
| `session.metadata.roundCounter` | `number` | 当前最大 roundId 值，单调递增 |

roundCounter 与 roundCount 的区别：
- `roundCount`：用户可见的"对话轮次数"，删除/回退时**不减少**
- `roundCounter`：内部单调递增的 ID 生成器，用于生成唯一的 roundId

---

## 3. 回滚执行流程

### 3.1 回退到消息 M（核心流程）

当用户点击「回退」到消息 M 时，整体流程如下：

```
用户点击「回退」到消息 M
  → 前端确认对话框
    → 确认
      → 后端 handler 收到 POST /v1/sessions/:id/messages/truncate
        → handler:

    1. 从 session.metadata.roundIndex 获取 roundIdOfM
    2. 收集所有 roundId > roundIdOfM 的快照（倒序，最新的先撤）
    3. 对每个轮次执行撤消：
       for (roundId in reverseSortedLaterRounds) {
         const result = await integration.undoRound(roundId)
         // 记录撤消结果（成功/失败/跳过）
       }
    4. 级联清理：清理被撤消轮次的快照文件
    5. 消息记录（原有方案的第 3 步）
    6. 清理 roundIndex 中已删除消息的条目
    7. 更新 session.metadata.roundCounter 不变
    8. 清理附件、FTS5 索引等（原有方案）

    → 返回 200 + 清理后的消息列表 / 或部分失败提示
```

### 3.2 删除单条消息

用户删除单条用户消息时，**不执行文件回滚**（因为后续消息没有变动，文件系统状态应该保持不变）。

**但存在风险**：如果用户删除了消息 M，但 AI 在 M 中修改了文件，后续用户继续对话时，AI 不知道那个修改是 M 做的。这可能导致 AI 上下文缺失。

**权衡决策**：单条删除 = 仅删除消息文本，不触及文件系统。风险告知用户（通过确认对话框文案）。

### 3.3 操作级别梯度

不是所有 AI 操作都可以回退。需要明确分级：

| 可逆性 | 操作源 | 操作类型 | 补偿方案 |
|:------:|--------|---------|---------|
| ✅ **可逆** | 工具 | 创建文件 | undoRound 会删除它 |
| ✅ **可逆** | 文件工具 | 修改文件 | undoRound 会恢复备份 |
| ✅ **可逆** | 文件工具 | 删除文件 | undoRound 会从备份恢复 |
| ✅ **可逆** | 文件工具 | 重命名/移动 | undoRound 会恢复原名/位置 |
| ⚠️ **部分可逆** | Shell | 创建/修改/删除 | 回滚引擎有 `getUnrestorableFiles()` 标记无备份的文件 |
| ⚠️ **不可逆** | 进程 | git commit/push | 无法自动 revert（需手动处理） |
| ❌ **不可逆** | 进程 | npm install/yarn | 可卸载但有污染残留 |
| ❌ **逆** | 网络 | HTTP/API 请求 | 外部状态不可控 |

### 3.4 不可逆操作的处理策略

对于不可逆/部分可逆的操作，回退时：

1. **回退前预览**：调用 `integration.previewUndoRound(roundId)` 获取变更摘要
2. **合并不可逆操作信息**：将 `unrestorableFiles` 等信息添加到预览结果中
3.UI 提示**：在确认对话框中明确告知用户哪些操作无法回退
4. **跳过策略**：不可逆操作在 undo 时被跳过（不报错），但记录在 `undoResult.failures` 中

回退 API 返回格式扩展：

```typescript
// 回退响应
interface RollbackResponse {
  success: boolean;
  /** 已被回退的消息（非此消息的 round——而是被删除的消息） */
  removedMessages: string[];
  /** 撤消结果（来自 rollback 系统） */
  undoResults: Array<{
    roundId: number;
 success: boolean;
    restoredFiles: number;    // deleted → 恢复
    revertedFiles: number;    // modified → 回退    removedFiles: number;     // created → 删除
    skippedUserModified: number; // 用户手动修改未覆盖
    failures: string[];       // 失败列表
    unrestorableFiles: string[]; // 无备份无法恢复的文件
  }>;
  /** 是否有不可逆操作被跳过 */
  hasIrreversibleOperations: boolean;
}
```

---

## 4. 实施计划

### Phase A: RoundIndex 数据结构 + 集成点

**改动清单**：

| # | 文件 | 改动 |
|:-:|:----|:----|
| A1 | `shared/types/message.ts` 或 `session.ts` | SessionMetadata 新增 `roundIndex` 和 `roundCounter` |
| A2 | `chat/ChatManager.ts` — `streamMessage()` | 在创建用户消息后插入 `roundIndex` 记录 + 调用 `RollbackIntegration.onRoundStart/onToolBeforeExecute/onRoundEnd` |
| A3 | `tools/write.ts`、`tools/edit.ts`、`tools/delete.ts` 等文件工具 | 在工具执行前回调 `rollbackIntegration.onToolBeforeExecute()` |
| A4 | `chat/ChatManager.ts` 或 `CoreAPIImpl.ts` | 在 `onRoundEnd` 后持久化 `session.metadata.roundIndex` |

**依赖关系**：A1 → A2 → A3 → A4

### Phase B: 回退 handler 集成回滚

| # | 文件 | 改动 |
|:-:|:----|:----|
| B1 | `infrastructure/http/handlers/message-handlers.ts` | 在 `truncateMessages` handler 中加入：查找 roundId → 倒序 undoRound → 清理快照 → 再删消息 |
| B2 | `infrastructure/http/handlers/message-handlers.ts` 或 `CoreAPIImpl.truncateMessages()` | 实现 `getRoundIdsAfterMessage()` 辅助方法 |
| B3 | `infrastructure/http/handlers/message-handlers.ts` | 返回扩展的 `RollbackResponse` 而非仅消息列表 |
| B4 | 前端 `chat-message.slice.ts` — `rollbackToMessage` | 处理返回结果中的 undoResults，展示给用户 |

**依赖关系**：A 全部 → B1 → B → B3 → B4

### Phase C: 不可逆操作提示（UI）

| # | 文件 | 改动 |
|:-:|:----|:----|
| C1 | 前端确认对话框 | 当 previewUndo 返回 `skippedUserModified > 0` 或 `unrestorableFiles > 0` 时，展示风险提示 |
| C2 | 前端结果展示 | 回退完成后，展示 summary（"恢复了 3 个文件，删除了 2 个文件，1 个 Shell 操作不可逆"） |
|3 | i18n | 补充新增文案 |

**依赖关系**：B 全部 → C1 → C2

---

## 5. 边界情况

### 5.1 roundIndex 中没有此消息

如果 `roundIndex[messageId]` 不存在（如旧会话、migration 遗漏），则：
- 回退时不执行文件撤消，仅删消息
- 返回 `undoResults: []`

### 5.2 跨轮次的文件依赖（级联撤消）

现有 `UndoManager.findDependentRounds()` 已经处理了文件依赖链。例如：
```
R1: 创建 a.ts
R2 修改 a.ts
R3: 修改 a.ts
```
回退到 R1 前的消息时，系统先撤消 R3，再撤消 R2，最后撤消 R1。

此逻辑已由 `executeUndo()` 中的级联检测自动处理。

### 5.3 回滚快照不存在

如果 `undoRound(roundId)` 时快照文件已被配额清理删除：
- **降级处理**：仅删消息 + 记录日志
- **用户可见**：在回退结果中标记 `snapshotMissing: true`

### 5.4 用户在回退前手动修改了文件

现有 `UndoManager.detectUserModifications()` 在执行 undo 前会用 hash 比对文件，如果用户手动改了文件，undo 会跳过此文件（不覆盖），并在 `skippedUserModified` 中计数。

### 5.5 多轮次同一条消息的 roundIndex

一个用户消息对应一个 roundId。但 AI 的**首次回复**和**重新生成回复**可能共享同一个 roundId（都对应同一个用户消息的 round）。

当 AI 重新生成回复时，`onRoundStart` 会被调用两次（同一 roundId），`FileOperationTracker.reset()` 会清空之前的状态。这是预期的行为——重新生成 = 覆盖之前的文件变更。

---

## 6. Migration

### 6.1 新数据初始化

所有新创建的 session，`roundIndex = {}`, `roundCounter = 0`。

### 6.2 现有 session（不含 roundIndex）

对于已经存在的 session（已有消息但没有 roundIndex），回退时降级处理：
- `roundIndex[messageId]` 不存在 → 跳过文件撤消，仅删消息
- 从用户角度，功能**可用但不完整**——消息被删但文件未回退

**可选升级脚本**：扫描所有已有 session，根据消息顺序重建 roundIndex（假设每条用户消息按 createdAt 升序对应 round 1, 2, 3...）。但此脚本在首次上线时非必须。

---

## 7. 架构对比总结

```
Before（原方案）:
  消息回退 → 只删消息记录 → 文件系统处于"变了但没记录"的状态

After（桥接方案）:
  消息回退 → 查 roundIndex → 倒序 undoRound → 删消息记录 → 文件系统也恢复了
                              ↓
                      RollbackIntegration
                              ↓
                    executeUndo() + WAL + UndoGuard
                              ↓
                    文件系统恢复到上轮状态
```

原有方案中影响分析的 11 个模块（附件、FTS5、roundCount、ReEntryBanner 等）仍按原方案修复不变。本方案在此基础上**增加了回滚引擎的集成**。

---

## 8. 关键风险

| 风险 | 概率 | 影响 | 缓解措施 |
|:----|:----:|:----:|:--------|
| undoRound 耗时较长（大量文件、大量轮次） | 中 | 响应慢，用户等待 | undo 前先 preview 展示估算，执行时异步处理 + loading |
| 用户删除中间消息后 roundIndex 断裂 | 高 | roundIndex 中漏删，下次回退可能处理已删消息的 round | 删除消息时同步清理 `roundIndex[messageId]` |
| 第三方工具（MCP 扩展）没有快照支持 |  | 外部工具创建的文件无法回退 | MCP 工具不在 rollback 追踪范围，回退时标注为不可逆 |
| 跨会话冲突（用户在不同 session 中修改了同一文件） | 低 | 撤消导致文件回归旧版本 | undo 时 `detectUserModifications` 会跳过 hash 不一致的文件 |
