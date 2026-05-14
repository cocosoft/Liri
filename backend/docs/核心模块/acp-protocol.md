# ACP 协议 - Agent 通信协议

## 概述

ACP (Agent Communication Protocol) 是 PY_APP 的 Agent 间通信协议，支持 Agent 之间的消息交换、任务委托和结果共享。

## 架构

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│ Agent A  │────▶│   ACP    │◀────│ Agent B  │
│ (Client) │     │  Server  │     │ (Client) │
└──────────┘     └──────────┘     └──────────┘
                       │
                       ▼
                ┌──────────────┐
                │  Translator  │
                │  (协议转换)   │
                └──────────────┘
```

## 核心组件

### Server

```typescript
import { ACPServer } from "./core/acp/server.js";

const server = new ACPServer({ port: 8080 });
await server.start();
```

### Client

```typescript
import { ACPClient } from "./core/acp/client.js";

const client = new ACPClient({ serverUrl: "http://localhost:8080" });
await client.connect();
```

### Session

```typescript
import { ACPSession } from "./core/acp/session.js";

const session = new ACPSession({
  clientId: "agent_1",
  targetId: "agent_2"
});

// 发送消息
await session.send({
  type: "task",
  payload: { action: "analyze", data: "..." }
});

// 接收消息
const response = await session.receive();
```

### Translator

```typescript
import { ACPTranslator } from "./core/acp/translator.js";

const translator = new ACPTranslator();

// 协议转换
const internal = translator.toInternal(externalMessage);
const external = translator.toExternal(internalMessage);
```

## 消息格式

```typescript
type ACPMessage = {
  id: string;
  source: string;
  target: string;
  type: "request" | "response" | "event" | "error";
  payload: unknown;
  timestamp: number;
  ttl?: number;
};
```

## 安全

- 支持消息签名验证
- 支持 TLS 加密传输
- 支持访问控制列表
