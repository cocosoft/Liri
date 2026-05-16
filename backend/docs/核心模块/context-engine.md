# Context Engine - 上下文引擎

## 概述

Context Engine 管理 Agent 运行时的上下文信息，包括会话历史、状态数据和环境信息，确保 Agent 能够理解并保持对话上下文。

## 核心功能

### 上下文管理

```typescript
import { ContextEngine } from "./core/context/index.js";

const engine = new ContextEngine();

// 添加上下文
await engine.addContext("conversation_1", {
  role: "user",
  content: "你好，帮我写一个函数"
});

// 获取上下文
const context = await engine.getContext("conversation_1");
```

### 上下文裁剪

```typescript
// 配置裁剪策略
engine.setPruningStrategy({
  maxTokens: 8000,
  strategy: "sliding_window",  // 滑动窗口
  preserveSystemPrompt: true
});
```

### 上下文搜索

```typescript
// 在上下文中搜索
const results = await engine.searchContext({
  query: "函数",
  limit: 10
});
```

## 组件说明

| 组件 | 说明 |
|------|------|
| delegate.ts | 上下文委托，处理上下文路由 |
| init.ts | 上下文初始化 |
| legacy.ts | 兼容旧版上下文格式 |
| registry.ts | 上下文源注册 |
| types.ts | 类型定义 |

## 上下文源注册

```typescript
// 注册自定义上下文源
engine.registerSource("database", {
  load: async (id) => { /* 从数据库加载 */ },
  save: async (id, data) => { /* 保存到数据库 */ }
});
```

## 性能优化

- 上下文缓存减少重复加载
- 智能裁剪控制 token 使用
- 异步加载避免阻塞
