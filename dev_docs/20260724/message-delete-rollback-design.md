# 用户消息气泡「删除」「回退」功能设计方案

> 日期: 2026-07-24 | 状态: 已优化（合并外部审阅 + 回滚桥接），待实施
> 关联文档: [message-rollback-bridge-design.md](./message-rollback-bridge-design.md) — 文件回滚引擎集成

## 1. 需求

用户消息气泡当前仅显示「✏️ 编辑」「🌿 分支」，改为四个常驻按钮：

| 按钮 | 功能 | 优先级 |
|------|------|:--:|
| 📋 复制 | 复制消息文本到剪贴板 | ✅ 已实现 |
| 🗑️ 删除 | 删除此条用户消息 | 🔲 待实现 |
| ↩️ 回退 | 回退到本轮对话发起前（截断此处及之后所有消息） | 🔲 待实现 |
| 🌿 分支 | 从更多菜单移到常驻行 | 🔲 待实现 |

### 1.1 现有能力基线（无需重新设计）

项目中已有完整的文件级回滚引擎，以下组件可直接复用：

| 能力 | 归属模块 | 直接复用 |
|:----:|:--------|:--------:|
| 文件快照创建与恢复 | `security/rollback/UndoManager.ts` — `executeUndo()` / `previewUndo()` | ✅ |
| 文件操作追踪（创建/修改/删除） | `security/rollback/FileOperationTracker` | ✅ |
| 轮次生命周期管理 | `security/rollback/RollbackIntegration` | ✅ |
| 会话级快照配额管理 | `security/rollback/CleanupManager.ts` — `enforceSnapshotQuota()`（5GB 默认，80% 清理阈值） | ✅ |
| FTS5 全文搜索索引清理 | `SessionGateway` (订阅事件) | ✅ |
| 存储层消息删除 | `StorageAdapter.deleteMessage/deleteMessages` | ✅ |
| ChatManager 回滚钩子 | `ChatManager._startRollbackRound()` / `_endRollbackRound()` / `_getRollbackIntegration()` | ✅ 已接线 |

**本方案的核心工作是建立消息系统到回滚引擎的桥接**（`roundIndex` 映射），而非从零搭建。

### 1.2 优先级标签说明

| 标签 | 含义 | 示例 |
|:----:|------|------|
| `[P0]` | 核心功能，第一阶段必须上线 | 消息删除、FTS5 清理、UI 确认对话框 |
| `[P1]` | 重要功能，第二阶段上线 | 回退 + 文件回滚集成、roundIndex、跨 Tab 同步 |
| `[P2]` | 增强功能，可延后 | Undo toast、Shell 副作用精确检测、跨会话保护 |

---

## 2. 影响范围分析

删除/回退消息不是简单的数组操作，波及 **5 大类 10+ 个模块**。

### 2.1 影响矩阵

| 严重度 | 模块 | 文件 | 后果 | 修复方案 |
|:------:|------|------|------|------|
| **高** | 文件回滚集成 | `security/rollback/`、`ChatManager.ts` | 回退消息时 AI 修改的文件未同步回退，文件系统处于不一致状态 | 建立 `roundIndex` 映射 → 回退时调用 undoRound 撤消文件操作，详见 [桥接方案](./message-rollback-bridge-design.md) |
| **高** | 附件文件 | `FileGCService.ts` | 消息附件引用的磁盘文件成孤儿 | 删除时同步清理；若多消息共享同一附件则用引用计数 |
| **高** | FTS5 搜索索引 | `SessionGateway.ts:404-422` | 删消息不发 `message:deleted` 则留脏索引 | 删除时发布批量 `messages:deleted` 事件，SessionGateway 一次 SQL 清理 |
| **高** | 乐观更新回滚 | `chat-message.slice.ts` | 前端先更新 UI 再调 API，失败后 UI 丢失消息但后端未删 | 保存快照，失败时回滚 + toast 提示 |
| **高** | 后端并发防护 | `message-handlers.ts` | 前端 disabled 不可靠，直接调 API 可绕过 | Handler 入口校验 `session.isStreaming`，持久化标记 |
| **中** | roundCount / messageCount | `CoreAPIImpl.ts:84-98` | 动态计算删消息后不准 | 持久化 `metadata.roundCount` + 上线迁移脚本 + fallback |
| **中** | 跨 Tab 同步 | `chat-message.slice.ts` | Tab A 删除后 Tab B 仍展示已删消息 | WebSocket 推送事件，多 Tab 同步更新 |
| **中** | retryFromError / regenerate | `chat-message.slice.ts:886-1032` | 找"最后一条 user 消息"，删中间消息后定位偏移 | 改为从后向前搜索 |
| **中** | Context 引擎（5 个） | `query/context/*.ts` | 从消息数组构建 LLM 上下文 | 预期行为——删消息本就应减少上下文 |
| **中** | ReasoningRetention | `ReasoningRetention.ts:50-97` | 找"最后一条 user 消息"，分界点偏移 | 改为从后向前搜索 |
| **中** | AwaySummaryService | `AwaySummaryService.ts:33-45` | 同样依赖从末尾向前找 user 消息 | 同上 |
| **中** | ReEntryBanner | `ReEntryBanner.tsx:34,112-115` | 按消息数算差值，删除后差值异常 | 改为记录 `lastMessageId` |
| **中** | 回退次数限制 | 新增 | 无限制回退可导致磁盘/索引膨胀 | 会话级上限 5 次，UI 展示剩余次数 |
| **中** | Shell 新文件追踪 | `FileOperationTracker.ts` | 快照对比仅检测已存在文件变化，Shell 新创建文件完全漏掉 | `[P1]` 引入声明-校验机制：Shell 执行前声明意图，执行后扫描对比 |
| **中** | 子 Agent 操作继承 | `ChatManager.ts` | `spawn` 的子 Agent 工具调用不被父 session 的 FileOperationTracker 记录 | `[P1]` 子 Agent 调用链传递 `parentRoundId`，操作归入父轮次 |
| **低** | parentId 悬空 | `DatabaseStorage.ts:110,239,328` | 物理删除后 `parentId` 悬空 | 改为软删除（`deleted_at` 字段），保留记录供引用 |
| **低** | CompactService ID 列表 | `CompactService.ts:144` | 引用已删除消息 ID | 无需修复 |
| **低** | 审计日志 | 新增 | 删除/回退不可逆但无操作记录 | 日志记录操作人、时间、内容摘要 |
| **无** | CostTracker / TokenTracker | `CostTracker.ts` | 事件驱动累加 | 无需修复 |
| **无** | Memory / Dream 系统 | `AutoMemoryService.ts` 等 | 通过 sessionId 关联 | 无需修复 |

### 2.2 需同步修复的模块（按优先级）

```
1. [P1] 文件回滚集成   — roundIndex 映射 + undoRound 调用（高）
2. [P0] 后端并发防护   — session.isStreaming 校验 + 持久化标记（高）
3. [P0] 前端乐观回滚   — 保存快照，失败恢复（高）
4. [P0] 批量事件合并   — messages:deleted 替代 N 个单事件（高）
5. [P0] 附件清理        — 删除时清理 + 引用计数（高）
6. [P0] FTS5 索引同步   — 订阅批量事件，一次 SQL（高）
7. [P1] roundCount 固化  — 迁移脚本 + fallback（中）
8. [P1] 跨 Tab 同步     — WebSocket 推送事件（中）
9. [P0] 搜索 lastUser 逻辑 — 从后向前搜索（中）
10. [P0] ReEntryBanner    — 改为 lastMessageId（中）
11. [P1] 回退次数限制    — 5 次/会话上限（中）
12. [P1] Shell 新文件追踪 — 声明-校验机制（中）
13. [P1] 子 Agent 操作继承 — parentRoundId 传递（中）
14. [P0] parentId 软删除  — deleted_at 字段（低）
15. [P0] 审计日志        — 操作记录（低）
```

### 2.3 回退原则：精确界定"有副作用的操作"

> 所有有副作用的操作都应该有记录，并且可以为每条记录定义一个逆向操作（或标记为"不可逆"）。

**必须记录**：`file_create`、`file_modify`、`file_delete`、`shell`（有文件副作用的）

**不需要记录**：`read_file`、`grep`、`glob`、`web_search`、`codeAnalysis`（只读/纯推理）

**无法完全逆向**（需标记告知用户）：`git commit`（文件恢复但 Git 历史还在）、`npm install`（`node_modules` 可删但全局 link 清不干净）、外部 API 调用（外部状态不可控）

### 2.4 Shell 新文件追踪（声明-校验）`[P1]`

当前 `FileOperationTracker.detectShellSideEffects()` 通过前后快照对比检测副作用，但**只能检测已存在文件的变化，Shell 创建的新文件完全漏掉**。

方案：引入"声明-校验"两步机制：

```
1. Shell 执行前：AI 在 system prompt 中被要求声明文件操作意图
   → 解析声明 → 记录预期操作列表
2. Shell 执行后：扫描文件系统 → 对比声明与实际 → 补录漏掉的副作用
```

### 2.5 子 Agent 操作继承 `[P1]`

`spawn` 的子 Agent 执行的工具调用，不被父 session 的 `FileOperationTracker` 记录。

方案：子 Agent 调用链传递 `parentRoundId`，子 Agent 的工具操作通过共享 tracker 归入父轮次。本质上是在 `spawn` 时传递一个引用，让子 Agent 的文件操作写入同一轮次的追踪器。

---

## 3. 后端 API 设计

### 3.1 删除单条消息

```
DELETE /v1/sessions/:sessionId/messages/:messageId
```

**Handler 执行步骤**：

```
1. 并发防护：检查 session.metadata.isStreaming，true 则返回 409 Conflict
2. 校验 messageId 存在且 role === "user"
3. 收集该消息的 attachments 文件列表，检查引用计数
4. 软删除消息（设 deleted_at = now()，保留 parentId 引用）
5. 清理附件文件（仅当引用计数归零）
6. 发布 globalEventBus.emit('messages:deleted', { sessionId, messageIds: [id] })
7. 写入审计日志
8. 返回更新后的消息列表
```

### 3.2 截断消息（回退）

```
POST /v1/sessions/:sessionId/messages/truncate
Body: { beforeMessageId: string }
```

**Handler 执行步骤**：

```
1. 并发防护：检查 session.metadata.isStreaming，true 则 409
2. 校验回退次数：session.metadata.rollbackCount >= 5 则 429 Too Many Requests
3. 文件回滚（核心新增）：
   a. 从 session.metadata.roundIndex 获取 targetMessage 对应的 roundId
   b. 收集 roundId 之后所有轮次的快照（倒序）
   c. 对每轮调用 RollbackIntegration.undoRound(roundId) — 撤消文件操作
   d. 级联清理快照文件
   e. 收集 undoResults（成功/失败/跳过/不可逆）
4. 消息记录处理：
   a. 找到 beforeMessageId 的位置，收集被删消息 id 列表
   b. 收集所有涉及的 attachments，检查引用计数
   c. 软删除所有消息（设 deleted_at）
   d. 清理附件文件（引用计数归零的）
5. 清理 roundIndex 中已删除消息的条目
6. 发布批量事件 messages:deleted { sessionId, messageIds: [...] }
7. 递增 session.metadata.rollbackCount
8. 保持 session.metadata.roundCount 和 roundCounter 不变
9. 写入审计日志
10. 返回截断后的消息列表 + 剩余回退次数 + undoResults
```

> 注：删除单条消息**不执行文件回滚**。文件回滚仅在回退（截断）时触发。

> 执行策略：三步顺序执行（非原子事务）—— `文件回滚 → 删消息 → 清理索引`。
> 每步成功后执行下一步。回滚失败则全部中止；删消息或清索引失败则记录日志 + 返回部分成功（已回滚的文件不回退）。

### 3.3 实现位置

- 路由注册：`route-table.ts`
- Handler：新建 `message-handlers.ts`
- 委托：`CoreAPIImpl.deleteMessage()` / `CoreAPIImpl.truncateMessages()`
- 事件发布：`globalEventBus.emit('messages:deleted', ...)`
- 索引清理：`SessionGateway` 订阅 `messages:deleted`，一次 SQL 批量清理 FTS5

---

## 4. 前端实现计划

### 4.1 Store 层（`chat-message.slice.ts`）

```typescript
deleteMessage: (messageId: string) => {
  const { messages, sessionId, isStreaming } = get();
  if (isStreaming) return;
  const index = messages.findIndex(m => m.id === messageId);
  if (index === -1 || messages[index].role !== "user") return;

  const prev = messages; // 快照，用于失败回滚
  set({ messages: messages.filter(m => m.id !== messageId) });

  sessionService.deleteMessage(sessionId!, messageId)
    .catch((err) => {
      set({ messages: prev }); // 回滚
      toast.error('删除失败，请重试');
    });
},

rollbackToMessage: (messageId: string) => {
  const { messages, sessionId, isStreaming } = get();
  if (isStreaming) return;
  const index = messages.findIndex(m => m.id === messageId);
  if (index === -1 || messages[index].role !== "user") return;

  const prev = messages;
  set({ messages: messages.slice(0, index) });

  sessionService.truncateMessages(sessionId!, messageId)
    .then((res) => {
      toast.info(`已回退（剩余 ${res.remainingRollbacks} 次）`);
    })
    .catch((err) => {
      set({ messages: prev });
      toast.error('回退失败，请重试');
    });
},
```

### 4.2 Service 层（`sessionService.ts`）

```typescript
async deleteMessage(sid: string, mid: string): Promise<Message[]> {
  const res = await http.del(`/v1/sessions/${sid}/messages/${mid}`);
  return res.data.messages;
}

async truncateMessages(sid: string, beforeMid: string): Promise<{ messages: Message[]; remainingRollbacks: number }> {
  const res = await http.post(`/v1/sessions/${sid}/messages/truncate`, { beforeMessageId: beforeMid });
  return res.data;
}
```

### 4.3 跨 Tab 同步

```typescript
// WebSocket 事件订阅（在 store 初始化时注册）
socket.on('messages:deleted', ({ sessionId, messageIds }: { sessionId: string; messageIds: string[] }) => {
  const state = get();
  if (state.sessionId === sessionId) {
    const deletedSet = new Set(messageIds);
    set({ messages: state.messages.filter(m => !deletedSet.has(m.id)) });
  }
});
```

### 4.4 UI 层（`ChatMessage.tsx`）

```tsx
{isUser && (
  <>
    <button onClick={(e) => handleCopy(!e.shiftKey)}>📋 复制</button>
    <button onClick={() => setEditTarget(message)}>✏️ 编辑</button>
    <button onClick={handleRollback} disabled={isStreaming}>↩️ 回退</button>
    <button onClick={handleDelete} disabled={isStreaming}>🗑️ 删除</button>
    <button onClick={handleBranch} disabled={branching}>
      {branching ? "🌿 分支中…" : "🌿 分支"}
    </button>
  </>
)}
```

确认对话框（简化版——无需异步扫描文件列表）：
- 删除：「确定要删除这条消息吗？」
- 回退（普通）：「回退到该消息将撤销此后的所有对话和文件操作。继续？」
- 回退（含不可逆操作时）：「⚠️ 该轮次包含不可逆操作（如外部 API 调用），部分状态无法回退。继续？（剩余 X/5 次）」

### 4.5 Undo Toast（可选增强）

```typescript
toast.success('已回退', {
  action: { label: '撤销', onClick: () => store.restoreMessages(snapshot) },
  duration: 3000,
});
```

> 撤销窗口 3 秒，后端暂不实现 restore API（改为 30 秒内保留软删除记录，前端可恢复）。

---

## 5. 数据流

```
用户点击「回退」
  → ChatMessage.handleRollback()
    → 弹出确认对话框（显示剩余次数）
      → 确认
        → store.rollbackToMessage(msgId)
          → prev = messages（快照）
          → set({ messages: truncated })
          → sessionService.truncateMessages(...)
            → POST /v1/sessions/:id/messages/truncate
              → handler:
                1. 校验 isStreaming → 409
                2. 校验 rollbackCount >= 5 → 429
                3. 收集 attachments + 引用计数检查
                4. 软删除消息（deleted_at）
                5. 清理零引用附件
                6. 发布 messages:deleted 批量事件
                7. SessionGateway 一次 SQL 清理 FTS5
                8. WebSocket 广播给其他 Tab
                9. 递增 rollbackCount，保持 roundCount
                10. 审计日志
                11. 返回 200 + 消息列表 + 剩余次数
          → 成功: toast + 剩余次数
          → 失败: set({ messages: prev }) + toast 错误
```

---

## 6. roundCount 固化 & roundIndex 存储方案

> `session.metadata` 当前定义在 `app/src/core/data-models.ts:189-220` (`DataSessionMetadata`)。
> 以下字段**全部不存在**：`roundCount`、`isStreaming`、`rollbackCount`。
> `roundIndex` 和 `roundCounter` 独立存储（见 6.3），不放入 metadata 以免拖慢读写。

### 6.1 持久化标记（存 metadata）

```typescript
// ChatManager — 用户消息创建时
session.metadata.roundCount = (session.metadata.roundCount ?? 0) + 1;

// 删除/回退时不修改
```

### 6.2 启动迁移

```typescript
// 启动时执行一次（幂等）
async function migrateRoundCount(): Promise<void> {
  const sessions = await storage.listSessions();
  for (const s of sessions) {
    if (s.metadata.roundCount == null) {
      s.metadata.roundCount = s.messages.filter(m => m.role === 'user' && !m.deleted_at).length;
      await storage.updateSession(s);
    }
  }
}
```

### 6.3 roundIndex 独立存储

`roundIndex` 是有增长趋势的键值映射表，不应放入 `SessionMetadata`（当前只存简单配置项如 `title`、`createdAt`）。分离存储：

```
~/.pyapp/data/sessions/{sessionId}/round_index.json
```

```json
{
  "msg_abc123": 1,
  "msg_def456": 2
}
```

或存入 SQLite 独立表：

```sql
CREATE TABLE session_rounds (
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  round_id   INTEGER NOT NULL,
  PRIMARY KEY (session_id, message_id)
);
```

**优势**：metadata 读写不受 roundIndex 数据量影响；roundIndex 独立增长，独立清理。

### 6.4 读取 fallback

```typescript
// getSession() 中
roundCount: session.metadata.roundCount ?? countUserMessages(session.messages.filter(m => !m.deleted_at))
```

---

## 7. 软删除 vs 物理删除

**决策：采用软删除**。

`messages` 表新增 `deleted_at TEXT` 字段（`NULL` = 未删除）：

| 方案 | 优点 | 缺点 |
|------|------|------|
| 物理删除 | 简单，不占空间 | parentId 悬空，无法撤销，FTS5 清理复杂 |
| **软删除** | parentId 有效，可撤销，统一查询过滤 | 需所有查询加 `WHERE deleted_at IS NULL` |

实施：
- 所有消息查询默认过滤 `deleted_at IS NULL`
- 30 天后由后台任务清理软删除记录（`CLEANUP_THRESHOLD_DAYS = 30`）
- FTS5 索引在软删除时即清理（不是等物理删除）

---

## 8. 测试策略

| 类型 | 覆盖内容 |
|------|---------|
| **单元** | handler 校验逻辑（409/429）、附件引用计数、乐观更新回滚 |
| **集成** | 删除→FTS5 同步、回退→roundCount 不变、批量事件发布→SessionGateway 消费 |
| **前端** | isStreaming 时 disabled、确认对话框流程、乐观更新→失败回滚→toast |
| **E2E** | 完整链路：点击→确认→UI 刷新→刷新页面→持久化验证 |
| **迁移** | 已有 session roundCount 迁移正确性、幂等性 |

---

## 9. 回退次数限制

- **上限**：5 次/会话（`session.metadata.rollbackCount`）
- **计数方式**：每次 truncate 调用 +1，删除单条不计
- **超限**：HTTP 429 + UI 显示"回退次数已用完"
- **UI 展示**：确认弹窗显示剩余次数，「↩️ 回退」按钮超限后 disabled

---

## 10. i18n 条目

| key | 中文 | 英文 |
|-----|------|------|
| `chat.deleteMessage` | 删除消息 | Delete Message |
| `chat.rollback` | 回退 | Rollback |
| `chat.confirmDelete` | 确定要删除这条消息吗？ | Delete this message? |
| `chat.confirmRollback` | 确定要回退到此消息之前吗？此消息及之后的所有回复将被移除。 | Rollback to before this message? All subsequent replies will be removed. |
| `chat.rollbackLimitReached` | 回退次数已用完（最多 5 次） | Rollback limit reached (max 5) |
| `chat.remainingRollbacks` | 剩余 {n} 次回退 | {n} rollbacks remaining |

---

## 11. 实施步骤

### Phase 1 (P0): 核心 — 消息删除 + 基础设施（约 2 小时）

> 上线标准：删除单条消息功能完整可用，UI 确认对话框，FTS5 同步清理
>
> 注：ChatManager 已有 `_startRollbackRound`/`_endRollbackRound`/`onToolBeforeExecute` 三钩子，无需新增集成点。

1. `messages` 表新增 `deleted_at` 字段 + 迁移脚本
2. 新建 `message-handlers.ts`，注册 `DELETE /v1/sessions/:id/messages/:msgId` 路由
3. 实现 `isStreaming` 持久化标记 + 并发防护
4. 实现 `CoreAPIImpl.deleteMessage()` — 含软删除、附件引用计数、批量事件、审计日志
5. `SessionGateway` 订阅 `messages:deleted` 批量事件，清理 FTS5
6. 前端 Store: `deleteMessage`（含乐观更新回滚）
7. 前端 UI: 复制/删除按钮 + 确认对话框 + i18n
8. `ReEntryBanner` → `lastMessageId`
9. `retryFromError` / `ReasoningRetention` / `AwaySummaryService` 搜索改为从后向前

### Phase 2 (P1): 回退 + 文件回滚集成（约 2 小时）

> 上线标准：回退功能完整可用，文件系统同步恢复，跨 Tab 同步

1. **RoundIndex 桥接**（ChatManager 已有 `_startRollbackRound`/`_endRollbackRound`/`onToolBeforeExecute` 三钩子，只需补记录）：
   - `DataSessionMetadata`（`data-models.ts:189`）新增 `roundIndex` + `roundCounter` + `roundCount` + `isStreaming` + `rollbackCount`
   - 在 `_startRollbackRound()` 中记录 `session.metadata.roundIndex[userMessageId] = roundId`
   - roundId 来自 `ToolResultRegistry.nextRound(sessionId)`（`ChatManager.ts:2486`）
2. 注册 `POST /v1/sessions/:id/messages/truncate` 路由
3. 实现 `CoreAPIImpl.truncateMessages()` — 含 undoRound 级联撤消 + 次数限制
4. roundCount 持久化 + 迁移脚本 + fallback
5. WebSocket 广播 `messages:deleted` 到其他 Tab
6. 前端 Store: `rollbackToMessage` + 跨 Tab 订阅
7. 前端 UI: 回退按钮 + 不可逆操作提示 + 剩余次数展示
8. Shell 声明-校验机制：补全新文件追踪盲区
9. 子 Agent `parentRoundId` 传递：操作归入父轮次

### Phase 3 (P2): 增强（可选，约 0.5 小时）

> 上线标准：UX 打磨，安全加固

1. Undo toast（3 秒撤销窗口）
2. Shell 副作用精确检测（`getUnrestorableFiles` 前端展示）
3. 分支按钮从更多菜单移到常驻行

---

## 12. 不做范围（Out of Scope）

| 不做 | 说明 |
|------|------|
| 跨会话回滚 | 回滚仅作用于当前 session，不影响其他 session 的同一文件 |
| 回退的回退（Redo） | 不支持“撤消刚才的回退” |
| 外部 API 调用副作用补偿 | 不支持回退 HTTP 请求、git push、npm install 等外部操作 |
| Shell 后台进程清理 | 不支持 kill 被 Shell 启动的后台进程 |
| 跨设备/多用户同步 | 回退操作不跨设备广播 |
| WAL 日志回放 | 不支持从 WAL 恢复到回退前的状态 |

**已纳入范围**（虽在原始需求外，但关闭回退链路所需）：

| 在范围内 | 说明 |
|---------|------|
| Shell 新文件追踪 | `[P1]` 声明-校验机制，补全 `detectShellSideEffects` 盲区 |
| 子 Agent 操作继承 | `[P1]` `parentRoundId` 传递，子 Agent 操作归入父轮次 |

---

## 13. 失败模式分析

| 阶段 | 失败场景 | 兜底策略 |
|:----:|:---------|:---------|
| 1 | roundIndex 中找不到 messageId | 降级：仅删消息，不执行文件回滚，返回 `undoResults: []` |
| 2 | 快照文件已损坏（checksum 校验失败） | 跳过该轮，记录到 `undoResults[].failures`，继续下一轮 |
| 3 | undo 时文件被用户手动修改（undoGuard 检测） | 跳过该文件，记录到 `skippedUserModified`，继续其他文件 |
| 4 | undo 时文件已被其他 session 删除 | 标记为 `notFound`，跳过，记录到 `failures` |
| 5 | 部分 undo 成功、部分失败（中断） | 已执行的 undo 不回退（文件操作无反向 undo）；返回结构化结果 `{ completed: [r3,r2], failed: [r1], reason }` → 前端展示“部分回滚”+ 失败原因 |
| 6 | undo 全部成功但 FTS5 清理失败 | 不影响主流程，记录日志，下次搜索时用户会搜到已删消息（可接受的降级） |
| 7 | undo 成功但 WebSocket 广播失败 | 其他 Tab 不会立即同步，需手动刷新（可接受的降级） |

---

## 15. 精简决策

以下功能**不实现**（付出复杂度但没有对应价值）：

| 不实现 | 理由 | 替代方案 |
|:------:|------|---------|
| 快照 checksum 校验 | 本地磁盘静默损坏几乎为 0，校验失败只能报错无其他决策分支 | 不做 |
| 回退前动态扫描受影响的文件列表 | 99% 场景用户不在乎具体文件，只想"回到过去" | 静态文案提示；仅 `irreversibility === 'severe'` 时展示详情 |
| roundIndex 存入 SessionMetadata | metadata 是轻量配置项，roundIndex 是增长型映射表 | 独立文件 `round_index.json` 或独立 SQLite 表 |
| 文件回滚+删消息+清索引三步原子事务 | 涉及文件系统+SQLite+FTS5，无共享事务上下文 | 顺序执行 + 独立错误处理；回滚失败全中止，其余失败记日志 |

---

## 16. 风险与注意事项

- **并发冲突**：前端 disabled + 后端 `isStreaming` 持久化校验，双重防护
- **乐观回滚**：失败时自动恢复 UI，不可静默吞错
- **附件孤儿**：删除时引用计数检查，归零才物理删除
- **FTS5 脏索引**：批量事件 + 单次 SQL 清理
- **roundCount 一致性**：持久化标记 + 迁移 + fallback，三重保障
- **跨 Tab 一致性**：WebSocket 实时同步
- **parentId**：软删除保留引用，30 天后后台清理
- **审计**：所有删除/回退操作记录日志
- **回退上限**：5 次/会话，UI 展示剩余次数
- **撤销**：3 秒 undo toast，30 秒内可恢复软删除记录
