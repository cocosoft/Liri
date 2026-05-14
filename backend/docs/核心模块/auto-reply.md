# AutoReply - 自动回复系统

## 概述

AutoReply 系统提供自动消息回复功能，支持消息分块、信封封装、心跳检测和智能分发。

## 架构

```
消息输入 → Envelope(封装) → Chunk(分块) → Dispatch(分发) → Reply(回复)
                                    ↑
                              Heartbeat(心跳检测)
```

## 核心组件

### Envelope - 消息信封

```typescript
import { AutoReplyEnvelope } from "./core/auto-reply/envelope.js";

const envelope = new AutoReplyEnvelope({
  content: "这是一条很长的消息...",
  maxSize: 4096
});

const wrapped = envelope.wrap();
```

### Chunk - 消息分块

```typescript
import { AutoReplyChunk } from "./core/auto-reply/chunk.js";

const chunker = new AutoReplyChunk({
  chunkSize: 2000,
  overlap: 100
});

const chunks = chunker.split(longMessage);
```

### Dispatch - 消息分发

```typescript
import { AutoReplyDispatch } from "./core/auto-reply/dispatch.js";

const dispatcher = new AutoReplyDispatch({
  channels: ["discord", "slack"],
  strategy: "round_robin"
});

await dispatcher.dispatch(message);
```

### Heartbeat - 心跳检测

```typescript
import { AutoReplyHeartbeat } from "./core/auto-reply/heartbeat.js";

const heartbeat = new AutoReplyHeartbeat({
  interval: 5000,
  timeout: 15000
});

heartbeat.on("missed", (channelId) => {
  console.log(`Channel ${channelId} heartbeat missed`);
});
```

### Reply - 回复处理器

```typescript
import { AutoReplyReply } from "./core/auto-reply/reply.js";

const replyHandler = new AutoReplyReply();

await replyHandler.send({
  channel: "discord",
  content: "处理完成",
  reference: originalMessageId
});
```

## 使用场景

- 多渠道消息广播
- 长消息自动分片
- 连接状态监控
- 智能路由分发
