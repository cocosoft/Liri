# Gateway - 网关服务

## 概述

Gateway 是 Liri 的消息网关（位于 `core/gateway/`），负责处理外部消息的路由、转换和分发，支持多协议接入（WebSocket、HTTP、MCP、OpenAI 兼容模式），并提供认证、限流、健康监控和 TLS 加密等能力。

## 基本用法

```typescript
import { GatewayServer } from "./core/gateway/GatewayServer.js";

const gateway = new GatewayServer({
  port: 8080,
  host: "0.0.0.0",
  tls: {
    enabled: process.env.NODE_ENV === "production"
  }
});

// 启动网关
await gateway.start();
```

## 渠道管理

Gateway 通过 ChannelManager 管理多渠道接入：

```typescript
import { ChannelManager } from "./core/gateway/ChannelManager.js";

const channelManager = new ChannelManager();

// 注册渠道插件
channelManager.register({
  name: "webhook",
  handler: async (message) => {
    return await processWebhook(message);
  }
});

// 启用/禁用渠道
channelManager.enable("webhook");
channelManager.disable("webhook");
```

## 协议支持

| 协议 | 说明 |
|------|------|
| WebSocket | 实时双向通信 |
| HTTP | REST API 接入 |
| MCP | Model Context Protocol 桥接 |
| OpenAI 兼容 | 兼容 OpenAI API 格式 |

## 事件总线

Gateway 内置事件总线，用于监听网关运行时事件：

```typescript
import { GatewayEventBus } from "./core/gateway/events/GatewayEventBus.js";

const events = new GatewayEventBus();

events.on("message:send", (event) => {
  console.log(`消息发送到 ${event.channel}`);
});

events.on("channel:error", (event) => {
  console.error(`渠道错误: ${event.channel}`, event.error);
});
```

## 认证与安全

```typescript
import { GatewayAuth } from "./core/gateway/auth/GatewayAuth.js";

const auth = new GatewayAuth({
  type: "api_key",
  keys: ["key1", "key2"]
});
```

## 健康监控

```typescript
import { HealthMonitor } from "./core/gateway/HealthMonitor.js";

const monitor = new HealthMonitor(gateway);

monitor.on("unhealthy", (report) => {
  logger.error("网关不健康", report);
});
```

## 限流

```typescript
import { RateLimiter } from "./core/gateway/RateLimiter.js";

const limiter = new RateLimiter({
  maxRequests: 100,
  windowMs: 60000,
  strategy: "sliding_window"
});
```

## MCP 桥接

```typescript
import { GatewayMcpBridge } from "./core/gateway/mcp/GatewayMcpBridge.js";

// 通过 MCP 协议连接外部服务
const mcp = new GatewayMcpBridge(gateway);
await mcp.connect("mcp://remote-service:8080");
```
