# Memory Host SDK - 记忆托管 SDK

## 概述

Memory Host SDK 提供记忆托管能力，支持 Agent 长期记忆的存储、检索和管理。

## 核心功能

### 记忆存储

```typescript
import { MemoryHostEngine } from "./core/memory-host-sdk/engine.js";

const engine = new MemoryHostEngine();

// 存储记忆
await engine.store({
  id: "mem_001",
  content: "用户偏好使用 VS Code 进行开发",
  metadata: { source: "conversation", confidence: 0.9 }
});
```

### 记忆查询

```typescript
import { MemoryHostQuery } from "./core/memory-host-sdk/query.js";

const queryEngine = new MemoryHostQuery(engine);

// 查询记忆
const results = await queryEngine.search("开发环境偏好");
```

### 记忆演进

```typescript
import { MemoryHostDreaming } from "./core/memory-host-sdk/dreaming.js";

// 记忆整合与关联
const dreams = await engine.dream();
```

## 组件说明

| 组件 | 文件 | 说明 |
|------|------|------|
| types.ts | 类型定义 | 记忆数据结构和接口 |
| secret.ts | 加密存储 | 敏感记忆加密 |
| status.ts | 状态管理 | 记忆状态监控 |
| query.ts | 查询引擎 | 记忆检索和匹配 |
| events.ts | 事件系统 | 记忆变更事件 |
| dreaming.ts | 记忆整合 | 记忆关联和演化 |
| engine.ts | 核心引擎 | 记忆生命周期管理 |
| runtime.ts | 运行时 | 记忆托管运行时 |

## 安全

- 敏感记忆自动加密
- 访问权限控制
- 审计日志记录
