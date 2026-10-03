# AutoReply - 自动回复系统

## 概述

AutoReply 系统提供消息自动回复的**分发**能力，位于 `core/auto-reply/`：
信封化（envelope）→ 文本分块（chunk）→ 按渠道分发（dispatch）→ 心跳保活（heartbeat）。

> **变更（2026-10-03，T-①04 T1-1）**：原 `ReplyOrchestrator`（`reply.ts`）属**零可达死码**
> （构造点 0、无任何消费者），已随「编排家族收敛」下线。本模块现由下列组件构成，
> 公开出口见 `core/auto-reply/index.ts`（经 `@modules/core` 可达）。

## 组件说明

| 组件 | 文件 | 说明 |
|------|------|------|
| ReplyDispatcher | dispatch.ts | 按渠道注册/分发处理器（`registerHandler` / `dispatch` / `dispatchBatch`；未注册渠道可走 `setDefaultHandler`） |
| HeartbeatManager | heartbeat.ts | 心跳保活管理 |
| createEnvelope / hasContent / mergeEnvelopes | envelope.ts | 信封创建、内容判定与合并 |
| chunkText / resolveChunkLimit | chunk.ts | 长文本分块与分块上限 |

## 使用场景

- AI Agent 回复消息的分发
- 跨渠道消息发送
- 长文本分段输出
- 长时间任务的心跳保活
