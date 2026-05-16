# AutoReply - 自动回复系统

## 概述

AutoReply 系统提供消息自动回复的编排能力，支持文本分块、心跳保活和多渠道分发，位于 `core/auto-reply/`。

## 基本用法

```typescript
import { ReplyOrchestrator } from "./core/auto-reply/index.js";

const orchestrator = new ReplyOrchestrator();

// 执行一次回复
const result = await orchestrator.reply({
  text: "你好！有什么可以帮你的吗？",
  channelId: "discord:123",
  accountId: "user_001",
  conversationId: "conv_456"
});

console.log(result.sent); // true / false
```

## 长文本分块

```typescript
// 分块发送长文本
const result = await orchestrator.replyChunked({
  text: longContent,
  channelId: "discord:123",
  accountId: "user_001",
  conversationId: "conv_456"
}, {
  chunkLimit: 2000  // 每块最大字符数
});
```

## 心跳保活

```typescript
// 长时间运行的回复启用心跳
const result = await orchestrator.reply(context, {
  heartbeatIntervalMs: 5000  // 每 5 秒发送心跳
});
```

## 批量回复

```typescript
// 批量回复多个上下文
const results = await orchestrator.replyBatch([
  { text: "回复1", channelId: "discord:1", accountId: "user_001", conversationId: "conv_1" },
  { text: "回复2", channelId: "discord:2", accountId: "user_002", conversationId: "conv_2" }
]);
```

## 组件说明

| 组件 | 文件 | 说明 |
|------|------|------|
| ReplyOrchestrator | reply.ts | 回复编排主类 |
| ReplyDispatcher | dispatch.ts | 消息分发器 |
| HeartbeatManager | heartbeat.ts | 心跳保活管理 |
| createEnvelope / chunkText | envelope.ts / chunk.ts | 信封创建与文本分块 |

## 使用场景

- AI Agent 回复消息的分发
- 跨渠道消息发送
- 长文本分段输出
- 长时间任务的心跳保活
