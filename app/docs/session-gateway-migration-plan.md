# SessionGateway 收敛迁移方案

## 1. 背景与目标

### 1.1 当前问题

Session 子系统存在**双路径并行架构**：

- **`SessionGateway`** (`session/SessionGateway.ts`) — 新统一网关，已有存储/转录/崩溃恢复/压缩/搜索/远程同步等能力
- **`SessionManager`** (`session/SessionManager.ts`) — 旧并行管理器，有 LRU 缓存/修剪/并发锁/优先级/QoS/预算/归档等独立能力
- **`ChatManager`** (`chat/ChatManager.ts`) — 同时持有两套实例，Proxy 拦截实现双写入

### 1.2 目标

将 `SessionManager` 所有功能收敛到 `SessionGateway`，消除双路径，简化架构。

### 1.3 约束

- 应用未发布，可以修改，但必须保证可用
- 运行通过 `tsc --noEmit`（0 错误）
- 不删数据、不改数据库结构

---

## 2. 工作量评估（总览）

| 阶段 | 工作量 | 复杂度 | 文件修改数 | 风险 |
|------|--------|--------|-----------|------|
| **A**: Gateway 功能补齐 | ~3-4 天 | 高 | 8-10 文件 | 中 |
| **B**: ChatManager 切换 | ~2-3 天 | 中 | 2-3 文件 | 高 |
| **C**: 清理与启动链更新 | ~0.5 天 | 低 | 3-4 文件 | 低 |
| **总计** | **~6-8 天** | **高** | **~15 文件** | **中高** |

**结论：工作量较大，建议按方案分步执行。**

---

## 3. Phase A：SessionGateway 功能补齐

### 3.1 需要迁移的功能清单

| 功能 | 来源 (SessionManager) | 目标 (SessionGateway) | 策略 |
|------|----------------------|----------------------|------|
| LRU 缓存 | `SessionStore` | `SessionGateway` 新增 | 添加内存缓存层 |
| 自动修剪 | `SessionPruner` | `SessionGateway` 新增 | 添加 prune 逻辑 + 定时器 |
| 并发锁 | `SessionLock` | `SessionGateway` 新增 | 添加 lock/unlock 方法 |
| 优先级管理 | `PriorityManager` | 新增模块 | 迁移完整类 |
| QoS 执行 | `QoSEnforcer` | 新增模块 | 迁移完整类 |
| 令牌预算 | `BudgetTracker` + `BudgetEnforcer` | 新增模块 | 迁移完整类 |
| 会话归档 | `SessionArchiver` | 新增模块 | 迁移完整类 |
| 检查点 | `CheckpointService` (独立) | 已有独立服务，无需迁移 | — |
| 压缩桥接 | `SessionCompactionBridge` | 已有 | 保持不变 |

### 3.2 详细修改清单

#### 3.2.1 SessionGateway 新增属性和方法

```typescript
// 新增属性
private sessionStore: SessionStore;          // LRU 缓存
private pruner: SessionPruner;               // 修剪器
private prunerInterval: Timer | null;        // 修剪定时器
private lock: SessionLock;                   // 并发锁
private archiver: SessionArchiver | null;    // 归档器

// 新增路径引用 (复用已有 storage)
// SessionStore 需要适配 UnifiedSessionStorage 接口
```

#### 3.2.2 新增公共 API

```typescript
// === 缓存 ===
getCacheStats(): Promise<CacheStats>

// === 修剪 ===
pruneNow(): Promise<PruneResult>
getPruneEstimate(): Promise<PruneEstimate>
setPrunerOptions(options: PrunerOptions): void

// === 并发锁 ===
acquireLock(sessionId: string, options?: LockOptions): Promise<boolean>
releaseLock(sessionId: string): Promise<void>
isLocked(sessionId: string): boolean

// === 优先级 / QoS ===
setSessionPriority(sessionId: string, level: SessionPriorityLevel, qos?: QoSLevel): void
getSessionPriority(sessionId: string): SessionPriority
getQoSEnforcer(): QoSEnforcer
getPriorityManager(): PriorityManager

// === 预算 ===
setSessionBudget(sessionId: string, config: SessionTokenBudgetConfig): void
recordTokenConsumption(sessionId: string, tokens: number, period?: BudgetPeriod): void
checkBudget(sessionId: string, estimatedTokens?: number): BudgetDecision
canProceedWithBudget(sessionId: string, estimatedTokens?: number): boolean
getBudgetTracker(): BudgetTracker
getBudgetEnforcer(): BudgetEnforcer

// === 归档 ===
archiveSession(sessionId: string, trigger?: ArchiveTrigger): Promise<ArchiveResult>
listArchivedSessions(): Promise<ArchiveMetadata[]>
getArchiveStats(): Promise<ArchiveStats>
setArchiver(archiver: SessionArchiver): void
```

#### 3.2.3 需要修改的文件

| 文件 | 修改类型 | 说明 |
|------|---------|------|
| `session/SessionGateway.ts` | **核心修改** | 新增 ~20 个方法 + 属性 |
| `session/SessionManager.ts` | 保留为适配层 | 暂时不动，Phase C 清理 |
| `session/SessionStore.ts` | 适配修改 | 改构造函数支持 `UnifiedSessionStorage` |
| `session/SessionPruner.ts` | 适配修改 | 改构造函数同上 |
| `session/SessionLock.ts` | 不移 | Gateway 直接实例化使用 |
| `session/qos/PriorityManager.ts` | 不移 | Gateway 直接实例化使用 |
| `session/qos/QoSEnforcer.ts` | 不移 | 同上 |
| `session/budget/BudgetTracker.ts` | 不移 | 同上 |
| `session/budget/BudgetEnforcer.ts` | 不移 | 同上 |
| `session/archive/SessionArchiver.ts` | 适配修改 | 确保 `storage` 参数兼容 |

#### 3.2.4 SessionStore 适配方案

当前 `SessionStore` 构造器接收 `SessionStorage`（旧接口），而 Gateway 使用 `UnifiedSessionStorage`（新接口）。需要：

- 在 `SessionStore` 中添加支持 `UnifiedSessionStorage` 的重载构造器
- 或创建适配器 `UnifiedStorageAdapter implements SessionStorage`

推荐方案：在 `session/storage/` 下创建适配器。改动集中，不影响现有逻辑。

### 3.3 验证标准

- `tsc --noEmit` 通过
- Phase A 新增的方法单元测试通过
- Gateway 的现有功能不受影响（初始化/创建/删除/搜索/压缩）

---

## 4. Phase B：ChatManager 切换为纯 Gateway 调用

### 4.1 当前调用映射

| ChatManager 代码 | 当前调用 | 替换为 |
|-----------------|---------|--------|
| `this.sessionManager.createSession(params)` | Mgr.createSession | `this.sessionGateway.createSession(params)` |
| `this.sessionManager.getSession(id)` | Mgr.getSession | `this.sessionGateway.getSession(id)` |
| `this.sessionManager.getCurrentSession()` | Mgr.getCurrentSession | `this.sessionGateway.getSession(currentId)` |
| `this.sessionManager.getSessions()` | Mgr.getSessions | `this.sessionGateway.listSessions()` |
| `this.sessionManager.deleteSession(id)` | Mgr.deleteSession | `this.sessionGateway.deleteSession(id)` |
| `this.sessionManager.saveSession(session)` | Mgr.saveSession | `this.sessionGateway.updateSession(session)` |
| `this.sessionManager.loadSession(id)` | Mgr.loadSession | `this.sessionGateway.getSession(id)` |
| `this.sessionManager.loadSessions()` | Mgr.loadSessions | `this.sessionGateway.listSessions()` |
| `this.sessionManager.setCurrentSession(id)` | Mgr.setCurrentSession | `this.sessionGateway.setCurrentSession(id)` |
| `this.sessionManager.addMessage(sid, msg)` | Mgr.addMessage | `this.sessionGateway.sendMessage(sid, msg)` |
| `this.sessionManager.createCheckpoint(...)` | Mgr.createCheckpoint | 调用独立 `SessionCheckpointService` |
| `this.sessionManager.listCheckpoints(...)` | Mgr.listCheckpoints | 同上 |
| `this.sessionManager.rollbackToCheckpoint(...)` | Mgr.rollbackToCheckpoint | 同上 |
| `this.sessionManager.deleteCheckpoint(...)` | Mgr.deleteCheckpoint | 同上 |
| `this.sessionManager.getLatestCheckpoint(...)` | Mgr.getLatestCheckpoint | 同上 |

**注意**：检查点功能由独立 `chat/services/SessionCheckpointService.ts` 提供，`SessionManager` 只是传方法，不需要迁移到 Gateway。ChatManager 改直接调用即可。

### 4.2 Proxy 拦截模式移除

当前 ChatManager 构造器中有 Proxy 拦截：

```typescript
// 当前（简化）
const originalSessionManager = this.sessionManager;
this.sessionManager = new Proxy(originalSessionManager, {
  get: (target, prop) => {
    if (prop === 'addMessage') {
      return (sessionId, message) => {
        target.addMessage(sessionId, message);
        this.persistMessage(sessionId, message).catch(...);
      };
    }
    return Reflect.get(target, prop, target);
  },
});
```

切换后移除整个 Proxy，`this.persistMessage()` 在相应位置直接调用：

```typescript
// 切换后
await this.sessionGateway.sendMessage(sessionId, message);
// Gateway.sendMessage 已内建持久化逻辑
```

### 4.3 风险点

| 风险 | 说明 | 缓解 |
|------|------|------|
| 返回类型差异 | `SessionManager.createSession` 返回 `ChatSession`，Gateway 返回 `UnifiedSession` | ChatManager 内部统一为 `UnifiedSession` |
| 内存状态丢失 | `SessionManager` 有内存 LRU 缓存 | Gateway 需要补缓存层（Phase A） |
| `getCurrentSession` | Gateway 无此概念 | Gateway 加 `currentSessionId` 字段 |

### 4.4 验证标准

- `tsc --noEmit` 通过
- ChatManager 所有功能路径走通
- 消息发送/会话切换/检查点等核心流程正常

---

## 5. Phase C：清理与启动链更新

### 5.1 init.ts 修改

当前 `init.ts` 第 411 行：

```typescript
const store = createSupervisorStore(SessionManager.instance.store);
```

需要改为 Gateway 的等价访问路径。

**方案**：`Gateway` 提供 `getStore()` 或 `getStorage()` 方法，或 `SessionSupervisor` 改为接收 `UnifiedSessionStorage`。

### 5.2 SessionManager 清理

Phase B 完成后，`ChatManager` 不再引用 `SessionManager`，可以：

- 删除 `SessionManager.ts`
- 检查是否有其他文件引用 `SessionManager`
- 清理伴生的旧存储文件（`FileSystemStorage`、`SessionStorage` 等）

### 5.3 需要检查的依赖

| 文件 | 当前依赖 | 处理 |
|------|---------|------|
| `chat/ChatManager.ts` | `createSessionManager`, `SessionManager` | 删除导入 |
| `entrypoints/init.ts` | `SessionManager.instance` | 替换引用 |
| `session/SessionSupervisor.ts` | `SessionStore` | 改为接收 Gateway |
| `session/SessionStateBridge.ts` | `SessionManager.instance.store` | 替换引用 |

### 5.4 需清理的孤儿文件

- `session/SessionManager.ts`
- `session/SessionStore.ts`（如不移入 Gateway 子模块）  
- `session/storage/FileSystemStorage.ts`（旧文件系统存储，与 `FileSystemUnifiedStorage.ts` 重复）
- `session/SessionStorage.ts`（旧接口定义）

### 5.5 验证标准

- `tsc --noEmit` 通过
- 应用启动正常（`SessionSupervisor` 能获取到会话存储）
- 无悬空导入

---

## 6. BUG 修复（已完成）

session/ 目录的 11 处 tsc 错误已在方案撰写过程中同时修复：

| # | 文件 | 修复内容 |
|---|------|---------|
| 1 | `AtomicWriter.ts` | `cause` 加 `override` 修饰符 |
| 2-4 | `CrashRecoveryManager.ts` | `SessionMetadata` 加 crashRecovery 等字段 |
| 5-7 | `FileSystemUnifiedStorage.ts` | `SessionFilter`/`UnifiedSession` 加 `agentId` |
| 8,10,11 | `FileSystemUnifiedStorage.ts` | `readdir` 类型标注改为 `Dirent[]` |

当前 `tsc --noEmit`：**0 错误** ✅

---

## 7. 执行路径建议

### 方案 A：全量迁移（推荐，但不紧急）

按 Phase A → B → C 顺序执行，每个 Phase 独立验证。

- **适合**：有 1-2 周完整开发时间
- **风险**：中等，每次 Phase 完成后可提交，可回退
- **预计工时**：6-8 天

### 方案 B：仅修复 BUG + 最小改动

- 修复已完成（11 处 tsc 错误）
- 不进行架构迁移
- 在 `SessionManager` 和 `SessionGateway` 之上加文档说明双路径

**适合**：当前有其他优先任务
**风险**：低，架构问题延后处理

### 方案 C：渐进式迁移（推荐）

1. **周 1**：Phase A 的前半部分（缓存 + 修剪 + 锁，3 天）
2. **周 2**：Phase A 的后半部分（优先级/QoS/预算/归档，2 天）+ Phase C（清理，0.5 天）
3. **周 3**：Phase B（ChatManager 切换，2-3 天）

**适合**：可分段投入时间，降低单次风险
**风险**：中，Phase B 之前 Gateway 和 SessionManager 会短暂同时拥有重叠功能

---

## 8. 风险与回退方案

| 风险 | 概率 | 影响 | 应对 |
|------|------|------|------|
| Gateway 新增功能引入回归 | 中 | 中 | 每个方法加单元测试；保留 SessionManager 作为回退 |
| ChatManager 切换后消息流异常 | 中 | 高 | Phase B 分批次替换，每次替换后验证核心流程 |
| 类型兼容问题 | 低 | 中 | Phase A 先统一 Gateway 返回类型 |
| SessionSupervisor 依赖移除后行为异常 | 低 | 中 | 保留对 `SessionManager.instance.store` 的备选访问 |
