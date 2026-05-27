# Session 模块架构分析与持久化实施方案

> 分析时间: 2026-05-24
> 分析范围: `backend/src/session/` 全部子模块

---

## 一、现状分析

### 1.1 模块规模

session 模块共有 **70+ 文件**,分布在 16 个子目录中,覆盖了会话管理的方方面面:

| 子模块         | 文件数 | 功能                                                                    |
| -------------- | ------ | ----------------------------------------------------------------------- |
| `core/`        | 7      | SessionManager, SessionStore, SessionGateway 等核心门面                 |
| `storage/`     | 6      | MemoryStorage, FileSystemStorage, DatabaseStorage, MemoryUnifiedStorage |
| `models/`      | 5      | Session, SessionMessage, SessionMetadata, SessionState 等数据模型       |
| `types/`       | 3      | UnifiedSession, UnifiedMessage, Transcript 等统一类型                   |
| `persistence/` | 2      | SessionPersistenceManager, AtomicWriter                                 |
| `transcript/`  | 1      | SessionTranscript (JSONL 转录文件)                                      |
| `archive/`     | 4      | 归档存储                                                                |
| `budget/`      | 5      | Token 预算追踪                                                          |
| `compaction/`  | 3      | 会话压缩桥接                                                            |
| `gateway/`     | 2      | 跨 Agent 聚合网关                                                       |
| `key/`         | 6      | Session Key 路由                                                        |
| `lifecycle/`   | 3      | 生命周期事件                                                            |
| `lock/`        | 2      | 优先级锁                                                                |
| `platform/`    | 5      | 多平台路由                                                              |
| `policy/`      | 3      | 重置策略                                                                |
| `pruning/`     | 4      | 上下文修剪                                                              |
| `qos/`         | 4      | 优先级与 QoS                                                            |
| `recovery/`    | 2      | 崩溃恢复                                                                |
| `remote/`      | 1      | 远程会话                                                                |
| `websocket/`   | 2      | WebSocket 通信                                                          |
| `maintenance/` | 1      | 会话维护                                                                |

### 1.2 核心问题:持久化未打通

**结论:Session 模块的持久化基础设施已经完备,但未被工具层和主流程使用。**

具体表现:

#### 问题 1: `SessionsTool` 使用硬编码 Mock 数据

`src/tools/SessionsTool/SessionsTool.ts` 中的 `MOCK_SESSIONS` 是纯内存数组:

```typescript
const MOCK_SESSIONS: SessionInfo[] = [
  { sessionId: 'sess_001', status: 'running', name: '主会话', ... },
  { sessionId: 'sess_002', status: 'completed', name: '代码审查', ... },
  // 硬编码数据,重启即丢
];
```

`handleHistory()` 方法生成的是 `Sample message N` 占位数据,完全不从 `SessionGateway` 或 `SessionManager` 读取。

#### 问题 2: `SessionsHistoryTool` 返回空数组

```typescript
// SessionsHistoryTool.ts
const result: HistoryQueryResult = {
  entries: [], // 永远返回空
  total: 0,
  filtered: 0,
  // ...
};
```

这个工具根本没有接入任何存储层。

#### 问题 3: `SessionGateway` 默认使用 `MemoryUnifiedStorage`

```typescript
// SessionGateway.ts 构造函数
this.storage = StorageFactory.createStorage(
  this.config.storageConfig ?? { type: StorageType.MEMORY }
);
```

**`StorageType.MEMORY` 是默认值**,意味着即使上层调用了 `SessionGateway`,数据也只存在内存里,重启即丢。

#### 问题 4: 虽然有 FileSystemStorage / DatabaseStorage,但未被注册到工厂

`StorageFactory` 使用注册表模式:

```typescript
const storageRegistry = new Map<
  StorageType,
  new (config: StorageConfig) => UnifiedSessionStorage
>();
registerStorage(StorageType.MEMORY, MemoryUnifiedStorage);
```

但 **`FileSystemStorage` 和 `DatabaseStorage` 实现了旧的 `SessionStorage` 接口**,而非新的 `UnifiedSessionStorage` 接口,所以无法通过 `StorageFactory` 使用。

### 1.3 架构断层图

```
工具层 (SessionsTool / SessionsHistoryTool)
    ↓   ✗ 未接入
SessionGateway (统一门面)
    ↓   ✗ 默认 Memory
存储层 (MemoryUnifiedStorage / FileSystemStorage / DatabaseStorage)
    ↓   ✓ 基础设施完备
文件系统 / SQLite
```

**存储层基础设施是完备的**,但工具层和门面层之间的连线没有接上。

---

## 二、实施方案

### 阶段一:打通 SessionGateway → 持久化存储 ⭐ 高优先级

#### 目标

让 `SessionGateway` 默认使用 `FileSystemStorage` 或 `DatabaseStorage`,而不是 `MemoryUnifiedStorage`。

#### 方案 A(推荐):实现 `FileSystemUnifiedStorage` 适配 `UnifiedSessionStorage`

**步骤:**

1. **新建 `src/session/storage/FileSystemUnifiedStorage.ts`**
   - 实现 `UnifiedSessionStorage` 接口
   - 复用现有的 `AtomicWriter` 保证写入原子性
   - 会话数据存为 `{sessionDir}/session.json`
   - 消息存为 `{sessionDir}/messages.jsonl`(追加写入)
   - 元数据存为 `{sessionDir}/metadata.json`

2. **在 `StorageFactory` 中注册**

   ```typescript
   registerStorage(StorageType.FILESYSTEM, FileSystemUnifiedStorage);
   ```

3. **修改 `SessionGateway` 默认配置**
   ```typescript
   // SessionGateway.ts
   this.storage = StorageFactory.createStorage(
     this.config.storageConfig ?? {
       type: StorageType.FILESYSTEM,
       basePath: './data/sessions',
     }
   );
   ```

#### 方案 B(备选):实现 `DatabaseUnifiedStorage` 适配 `UnifiedSessionStorage`

如果希望使用 SQLite:

- 新建 `src/session/storage/DatabaseUnifiedStorage.ts`
- 实现 `UnifiedSessionStorage` 接口
- 使用 `better-sqlite3` 替代 `sqlite3`(同步 API 更简单)
- 建表:`sessions`, `messages`

#### 代码量估计

| 文件                          | 行数        |
| ----------------------------- | ----------- |
| `FileSystemUnifiedStorage.ts` | ~250 行     |
| `StorageFactory` 注册         | ~5 行       |
| `SessionGateway` 默认配置修改 | ~5 行       |
| **合计**                      | **~260 行** |

---

### 阶段二:工具层接入 SessionGateway ⭐ 高优先级

#### 目标

让 `SessionsTool` 和 `SessionsHistoryTool` 从 `SessionGateway` 读取真实数据。

#### 步骤

1. **为 `SessionsTool` 注入 `SessionGateway` 实例**

   ```typescript
   // SessionsTool.ts
   class SessionsTool extends BaseTool {
     private gateway: SessionGateway;

     constructor(gateway?: SessionGateway) {
       super();
       this.gateway = gateway ?? createSessionGateway();
     }
   }
   ```

2. **重写 `handleList` 方法**
   - 从 `this.gateway.listSessions()` 获取真实会话列表
   - 映射为 `SessionInfo` 格式返回

3. **重写 `handleHistory` 方法**
   - 从 `this.gateway.getMessages(sessionId)` 获取真实消息
   - 支持分页、时间过滤

4. **在应用启动时注入 gateway**
   - 在 `main.ts` 或 `bootstrap` 阶段创建 `SessionGateway`
   - 传入 `SessionsTool` 构造函数

#### 代码量估计

| 文件                     | 修改量      |
| ------------------------ | ----------- |
| `SessionsTool.ts`        | ~80 行      |
| `SessionsHistoryTool.ts` | ~40 行      |
| 启动注入代码             | ~15 行      |
| **合计**                 | **~135 行** |

---

### 阶段三:会话消息实时持久化 ⭐ 中优先级

#### 目标

每次 AI 交互的消息都自动持久化到存储层。

#### 步骤

1. **在 ChatManager / Agent 主循环中接入 SessionGateway**
   - 每次收到用户消息 → `gateway.sendMessage(sessionId, message)`
   - 每次 AI 回复完成 → `gateway.sendMessage(sessionId, message)`
   - 每次工具调用 → `gateway.sendMessage(sessionId, message)`

2. **利用现有的 `TranscriptManager` 做辅助持久化**
   - `TranscriptManager` 已经实现了 JSONL 文件追加写入
   - 可以作为第二层持久化保证

#### 代码量估计

| 文件                       | 修改量     |
| -------------------------- | ---------- |
| Agent 主循环 / ChatManager | ~50 行     |
| **合计**                   | **~50 行** |

---

### 阶段四:历史会话查询 & 搜索 ⭐ 中优先级

#### 目标

支持 `/session history` 命令查询历史记录,支持全文搜索。

#### 步骤

1. **完善 `SessionsHistoryTool`**
   - 接入 `SessionGateway.getMessages()`
   - 支持 `since`/`until` 时间过滤
   - 支持 `limit`/`offset` 分页

2. **利用现有的 `FTS5SearchEngine`**
   - `src/session/FTS5SearchEngine.ts` 已经实现了 SQLite FTS5 全文搜索
   - 在消息写入时同步索引到 FTS5
   - 搜索时通过 FTS5 快速检索

#### 代码量估计

| 文件                     | 修改量      |
| ------------------------ | ----------- |
| `SessionsHistoryTool.ts` | ~60 行      |
| `FTS5SearchEngine` 集成  | ~40 行      |
| **合计**                 | **~100 行** |

---

### 阶段五:系统启动时自动恢复会话 ⭐ 低优先级

#### 目标

应用重启后,`SessionsTool.list()` 能显示之前的所有会话。

#### 步骤

1. **`SessionGateway.initialize()` 时自动扫描存储目录**
   - 读取 `./data/sessions/` 下所有会话目录
   - 重建 `UnifiedSession` 索引

2. **`SessionManager.initialize()` 时加载已有会话**
   - 自动恢复上次的会话列表

#### 代码量估计

| 文件                | 修改量     |
| ------------------- | ---------- |
| `SessionGateway.ts` | ~30 行     |
| `SessionManager.ts` | ~20 行     |
| **合计**            | **~50 行** |

---

## 三、实施路线图

| 阶段                  | 优先级 | 工作量  | 效果         | 依赖       |
| --------------------- | ------ | ------- | ------------ | ---------- |
| **一**:持久化存储实现 | ⭐⭐⭐ | ~260 行 | 数据不再丢   | 无         |
| **二**:工具层接入     | ⭐⭐⭐ | ~135 行 | 能查真实数据 | 阶段一     |
| **三**:实时持久化     | ⭐⭐   | ~50 行  | 消息自动存   | 阶段一     |
| **四**:历史查询搜索   | ⭐⭐   | ~100 行 | 能搜历史     | 阶段一、二 |
| **五**:启动恢复       | ⭐     | ~50 行  | 重启不丢     | 阶段一     |

**总计代码量:约 595 行**

---

## 四、风险与注意事项

1. **`SessionStorage` vs `UnifiedSessionStorage` 接口不兼容**
   - 旧接口 `SessionStorage`(`saveSession`/`loadSession` 等)有 11 个方法
   - 新接口 `UnifiedSessionStorage`(`createSession`/`getSession` 等)有 20+ 个方法
   - 旧实现 (`FileSystemStorage`, `DatabaseStorage`, `MemoryStorage`) 不能直接用于新接口
   - **建议:弃用旧接口,统一使用新接口**

2. **`SessionManager` 和 `SessionGateway` 职责重叠**
   - `SessionManager` 使用旧接口 + 旧模型 (`Session`, `SessionMessage`)
   - `SessionGateway` 使用新接口 + 新模型 (`UnifiedSession`, `UnifiedMessage`)
   - 两者都提供类似的功能,但数据模型不同
   - **建议:逐步废弃 `SessionManager`,统一走 `SessionGateway`**

3. **文件系统 vs 数据库选择**
   - 文件系统:简单、无依赖、JSON 可读
   - SQLite:查询能力强、支持 FTS5 全文搜索
   - **建议:先用文件系统(零依赖),后续可加 SQLite 作为可选后端**

4. **性能考虑**
   - 每条消息都写磁盘可能影响交互速度
   - **建议:写操作异步化**,使用队列批量写入
   - 内存缓存 (`SessionStore` 的 LRU Cache) 已实现,可以复用
