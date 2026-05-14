# 会话模型

## 概述

Session（会话）代表用户与 Agent 之间的一次连续交互过程。

## 会话结构

```typescript
interface Session {
  id: string;
  userId: string;
  messages: Message[];
  context: Record<string, unknown>;
  attributes: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
}
```

## 会话生命周期

```
创建 → 活跃 → 超时/关闭
               ↓
             归档/删除
```

### 创建

- 用户首次与 Agent 交互时自动创建
- 支持显式创建（指定上下文）

### 活跃

- 会话保持活跃状态
- 消息持续追加
- 上下文实时更新

### 超时

- 无活动超过阈值自动超时
- 默认超时时间：30 分钟
- 可配置超时策略

## 会话隔离

每个会话拥有独立的上下文空间，互不干扰。这是多用户场景下的基础隔离机制。

## 会话持久化

- 会话数据定期持久化到磁盘
- 支持从磁盘恢复会话
- 磁盘预算管理防止无限增长
