# SessionManager - 会话管理

## 概述

SessionManager 管理用户会话，包括会话创建、持久化、状态维护和清理。

## 基本用法

```typescript
import { SessionManager } from "./session/index.js";

const sessionManager = new SessionManager();

// 创建会话
const session = await sessionManager.createSession({
  userId: "user_123",
  context: { language: "zh-CN" }
});

// 获取会话
const existing = await sessionManager.getSession(session.id);
```

## 会话属性

```typescript
// 获取和设置会话属性
session.setAttribute("theme", "dark");
const theme = session.getAttribute("theme");

// 批量设置
session.setAttributes({
  language: "en",
  timezone: "Asia/Shanghai"
});
```

## 会话持久化

```typescript
// 保存会话到磁盘
await sessionManager.persist(session.id);

// 从磁盘恢复会话
const restored = await sessionManager.restore(session.id);

// 删除会话
await sessionManager.deleteSession(session.id);
```

## 会话生命周期

```typescript
// 配置会话超时
const config = {
  timeout: 1800000,      // 30 分钟无活动超时
  maxMessages: 1000,     // 最大消息数
  cleanupInterval: 60000 // 清理检查间隔
};
```

## 会话转录

```typescript
// 获取会话转录
const transcript = await sessionManager.getTranscript(session.id);

// 搜索会话内容
const results = await sessionManager.searchTranscripts({
  keyword: "error",
  dateRange: { start: "2024-01-01", end: "2024-12-31" }
});
```

## 磁盘预算管理

```typescript
// 设置磁盘预算
sessionManager.setDiskBudget({
  maxSize: "1GB",
  cleanupPolicy: "oldest_first"
});
```
