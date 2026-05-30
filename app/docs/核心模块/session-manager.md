# SessionGateway — 统一会话网关

## 概述

`SessionGateway` 是 Liri 的统一会话管理入口，整合了会话创建、持久化、状态维护、生命周期事件、FTS5 全文搜索、QoS/优先级、预算管理、归档、修剪压缩等所有会话相关能力。

> **架构变迁**：旧 `SessionManager` 已标记为 `@deprecated`，新代码应直接使用 `SessionGateway`。如需向后兼容，通过 `SessionManagerAdapter` 桥接。

## 架构总览

```
┌──────────────────────────────────────────────────────────────────┐
│                        SessionGateway                            │
├──────────────────────────────────────────────────────────────────┤
│  ┌────────────┐  ┌───────────┐  ┌────────────┐  ┌─────────────┐ │
│  │ Unified    │  │ Transcript│  │ Session    │  │ Session     │ │
│  │ Storage    │  │ Manager   │  │ Store      │  │ Pruner      │ │
│  └────────────┘  └───────────┘  └────────────┘  └─────────────┘ │
│  ┌────────────┐  ┌───────────┐  ┌────────────┐  ┌─────────────┐ │
│  │ Session    │  │ Priority  │  │ QoS        │  │ Budget      │ │
│  │ Lock       │  │ Manager   │  │ Enforcer   │  │ Tracker     │ │
│  └────────────┘  └───────────┘  └────────────┘  └─────────────┘ │
│  ┌────────────┐  ┌───────────┐  ┌────────────┐  ┌─────────────┐ │
│  │ Archiver   │  │ Lifecycle │  │ Compaction │  │ FTS5 Search │ │
│  │            │  │ EventBus  │  │ Bridge     │  │ Engine      │ │
│  └────────────┘  └───────────┘  └────────────┘  └─────────────┘ │
│  ┌────────────┐  ┌───────────┐  ┌────────────┐                  │
│  │ Remote     │  │ WebSocket │  │ SessionKey │                  │
│  │ Sessions   │  │ Sessions  │  │ Factory    │                  │
│  └────────────┘  └───────────┘  └────────────┘                  │
└──────────────────────────────────────────────────────────────────┘
```

## 基本用法

### 创建网关

```typescript
import { SessionGateway, createSessionGateway } from './session/index.js';

// 快速创建（默认文件系统存储）
const gateway = createSessionGateway();

// 手动创建并装配所有服务
const gateway = new SessionGateway()
  .wireWithFullServices();

await gateway.initialize();
```

### 会话 CRUD

```typescript
// 创建会话
const session = await gateway.createSession({
  title: '新会话',
  userId: 'user_123',
  chatType: 'direct',
  metadata: { language: 'zh-CN' }
});

// 获取会话
const existing = await gateway.getSession(session.id);

// 更新会话
existing.title = '更新标题';
await gateway.updateSession(existing);

// 删除会话
await gateway.deleteSession(session.id);

// 列出活跃会话
const sessions = await gateway.listSessions({
  status: 'active',
  limit: 20
});
```

### 消息管理

```typescript
import { ContentBlockType } from './session/types/Message.js';

// 发送消息
await gateway.sendMessage(session.id, {
  id: randomUUID(),
  role: 'user',
  type: 'text',
  content: 'Hello, world!',
  timestamp: Date.now(),
  blocks: [{ type: ContentBlockType.TEXT, text: 'Hello, world!' }]
});

// 获取消息
const messages = await gateway.getMessages(session.id, {
  limit: 50,
  offset: 0
});
```

### 令牌追踪

```typescript
// 记录令牌用量
gateway.recordTokenUsage(session.id, {
  promptTokens: 150,
  completionTokens: 50,
  cacheReadTokens: 20
});

// 获取令牌用量
const usage = gateway.getTokenUsage(session.id);
```

## 存储后端

支持多种存储后端，通过 `UnifiedSessionStorage` 接口统一：

| 后端 | 类 | 说明 |
|------|-----|------|
| 文件系统 | `FileSystemUnifiedStorage` | 默认，JSON 文件持久化 |
| 内存 | `MemoryUnifiedStorage` | 测试环境，进程内存储 |
| 数据库 | `DatabaseStorage` | SQLite 持久化 |

```typescript
import { StorageFactory, StorageType } from './session/index.js';

const storage = StorageFactory.createStorage({
  type: StorageType.MEMORY  // 内存模式，适合测试
});
const gateway = new SessionGateway({ storageConfig: { type: StorageType.MEMORY } });
```

## 生命周期事件

通过 `SessionLifecycleEventBus` 发布/订阅会话事件：

```typescript
const eventBus = gateway.getEventBus();

// 订阅会话创建事件
eventBus.on('session:created', (event) => {
  logger.info('会话已创建', { sessionId: event.sessionId });
});

// 订阅消息创建事件
eventBus.on('message:created', (event) => {
  const { messageId, content } = event.metadata ?? {};
  // FTS5 索引已自动更新
});

// 订阅会话删除事件
eventBus.on('session:deleted', (event) => {
  logger.info('会话已删除', { sessionId: event.sessionId });
});
```

支持的事件类型：`session:created`、`session:deleted`、`message:created`、`message:deleted`

## 会话锁定

防止并发操作导致的数据竞争：

```typescript
// 获取锁
const result = await gateway.acquireLock(session.id, { timeout: 5000 });
if (result.acquired) {
  try {
    // 执行安全操作
  } finally {
    await gateway.releaseLock(session.id);
  }
}

// 检查锁定状态
const locked = await gateway.isLocked(session.id);
```

## 优先级与 QoS

管理会话的服务质量：

```typescript
// 设置会话优先级
gateway.setSessionPriority(session.id, 'high', 'premium');

// 获取优先级管理器（用于高级配置）
const priorityManager = gateway.getPriorityManager();
```

## 预算管理

追踪和强制令牌预算上限：

```typescript
const budgetTracker = gateway.getBudgetTracker();
const budgetEnforcer = gateway.getBudgetEnforcer();

// 检查预算决策
const decision = budgetEnforcer?.checkBudget(session.id, {
  estimatedTokens: 500
});
if (decision?.allowed) {
  // 允许执行
} else {
  logger.warn('预算不足', { reason: decision?.reason });
}
```

## 会话归档

```typescript
// 归档器通过 wireWithFullServices 自动注入
const archiver = gateway.setSessionArchiver(/* ... */);

// 归档已完成的会话
await gateway.archiveSession(session.id, {
  trigger: 'manual',
  metadata: { reason: '用户完成' }
});
```

## 修剪与压缩

自动管理上下文窗口大小，防止词元溢出：

### 修剪（Pruning）

移除最旧的消息以控制上下文长度：

```typescript
// 通过 wireWithFullServices 自动启用修剪（每 5 分钟执行一次）
// 手动触发修剪
const result = await gateway.pruneNow();
logger.info(`修剪完成: ${result?.prunedSessions} 个会话`);

// 获取修剪预估
const estimate = await gateway.getPruneEstimate();

// 动态调整修剪选项
gateway.setPrunerOptions({
  maxSessions: 500,
  idleThresholdMs: 86400000  // 24 小时
});
```

### 压缩（Compaction）

对会话历史进行语义压缩，保留关键信息的同时减少词元数：

```typescript
const result = await gateway.compactSession(session.id, 'deepseek-chat');
if (result?.success) {
  logger.info('会话压缩成功', { record: result.record });
}

// 查看压缩历史
const history = gateway.getCompactionHistory(session.id);
```

## FTS5 全文搜索

基于 FTS5 引擎的全文搜索，支持跨会话消息检索：

```typescript
// 搜索所有会话中的消息
const results = gateway.searchMessagesFTS('error 数据库');

// 按会话过滤
const sessionResults = gateway.searchMessagesFTS(
  '认证失败',
  session.id,
  20  // 限制返回条数
);

for (const result of sessionResults) {
  logger.info('搜索结果', {
    messageId: result.metadata?.messageId,
    content: result.content.substring(0, 100)
  });
}
```

## 会话转录（Transcript）

```typescript
// 加载会话转录
const transcript = await gateway.loadTranscript(session.id);

// 搜索转录内容
const searchResult = await gateway.searchTranscript(session.id, '配置');

// 获取转录统计
const stats = await gateway.getTranscriptStats(session.id);
```

## 远程会话与 WebSocket

### 远程会话

```typescript
const remoteSession = gateway.createRemoteSession(
  {
    sessionId: 'remote_001',
    wsUrl: 'wss://example.com/session',
    orgUuid: 'org_abc'
  },
  {
    onMessage: (msg) => logger.info('远程消息', { msg }),
    onError: (err) => logger.error('远程错误', { err })
  }
);
```

### WebSocket 会话

```typescript
const ws = gateway.createWebSocket(
  session.id,
  {
    url: 'wss://example.com/ws',
    getAccessToken: () => 'bearer_token',
    orgUuid: 'org_abc'
  },
  {
    onMessage: (data) => console.log('WS 消息', data),
    onStateChange: (state) => console.log('WS 状态', state)
  }
);
```

## 会话统计

```typescript
// 全局统计
const globalStats = await gateway.getSessionStats();
logger.info('会话统计', {
  total: globalStats.totalSessions,
  active: globalStats.activeSessions,
  archived: globalStats.archivedSessions,
  totalMessages: globalStats.totalMessages
});

// 单会话统计
const sessionStats = await gateway.getSessionStats(session.id);

// 缓存统计
const cacheStats = gateway.getCacheStats();
```

## 从旧 SessionManager 迁移

旧 `SessionManager` 已标记为 `@deprecated`，迁移路径如下：

```typescript
// 旧代码
import { SessionManager } from './session/index.js';
const manager = new SessionManager(options);

// 新代码
import { SessionGateway, SessionManagerAdapter } from './session/index.js';
const gateway = new SessionGateway(config).wireWithFullServices();
const adapter = new SessionManagerAdapter(gateway);
// 通过 adapter.store 访问 SessionStore 兼容接口
```

> `SessionManagerAdapter` 提供向后兼容的 `SessionStore` 接口，使存量代码无需修改即可使用新后端。

## 与 SessionSupervisor 集成

`SessionSupervisor` 会话监管器提供空闲检测和自动回收能力，在 `init.ts` 的延迟预加载阶段自动启动：

```typescript
import { SessionGateway, SessionManagerAdapter } from './session/index.js';
import { SessionSupervisor } from './core/session/SessionSupervisor.js';
import { createSupervisorStore } from './core/session/SessionStoreAdapter.js';

const gateway = new SessionGateway();
const adapter = new SessionManagerAdapter(gateway);
const store = createSupervisorStore(adapter.store);
const supervisor = new SessionSupervisor(store, {
  resetPolicy: {
    mode: 'idle',
    idleMinutes: 30,     // 30 分钟空闲超时
    preserveMetadata: true
  }
});
supervisor.start();
```

## 配置参考

```typescript
interface SessionGatewayConfig {
  storageConfig?: StorageConfig;         // 存储配置（类型、路径）
  transcriptConfig?: TranscriptManagerConfig; // 转录配置
  remoteConfig?: {
    wsUrl?: string;
    orgUuid?: string;
  };
  keyFactoryConfig?: SessionKeyFactoryConfig; // 会话 Key 工厂配置
  wireServices?: boolean;                // 是否自动装配基础服务
}
```

## 子模块索引

| 目录 | 说明 |
|------|------|
| `storage/` | 存储后端（文件系统/内存/数据库） |
| `key/` | 会话 Key 生成与管理、路由 |
| `lifecycle/` | 生命周期事件总线 |
| `lock/` | 优先级会话锁 |
| `qos/` | 服务质量与优先级管理 |
| `budget/` | 令牌预算追踪与执行 |
| `archive/` | 会话归档 |
| `compaction/` | 会话压缩（语义摘要） |
| `pruning/` | 上下文修剪与缓存 TTL |
| `persistence/` | 原子写入与持久化 |
| `transcript/` | 会话转录管理 |
| `recovery/` | 崩溃恢复 |
| `maintenance/` | 会话维护 |
| `platform/` | 平台适配器 |
| `policy/` | 重置策略 |
| `websocket/` | WebSocket 会话支持 |
| `remote/` | 远程会话管理 |
| `models/` | Session、Message、Metadata 数据模型 |
| `types/` | TypeScript 类型定义 |
