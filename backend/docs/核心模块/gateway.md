# Gateway - 网关服务

## 概述

Gateway 是 PY_APP 的消息网关，负责处理外部消息的路由、转换和分发，支持多种消息渠道的接入。

## 基本用法

```typescript
import { Gateway } from "./remote/gateway/Gateway.js";

const gateway = new Gateway();

// 注册渠道
gateway.registerChannel("webhook", {
  handler: async (message) => {
    return await processWebhook(message);
  }
});

// 发送消息
await gateway.send({
  channel: "webhook",
  content: "Hello",
  target: "https://example.com/webhook"
});
```

## 渠道管理

### 注册渠道

```typescript
gateway.registerChannel("custom", {
  name: "自定义渠道",
  handler: customHandler,
  middleware: [logger, validator]
});
```

### 渠道状态

```typescript
// 启用/禁用渠道
gateway.enableChannel("webhook");
gateway.disableChannel("webhook");

// 获取渠道状态
const status = gateway.getChannelStatus("webhook");
```

## 消息转换

```typescript
// 注册消息转换器
gateway.addTransformer((message) => {
  return {
    ...message,
    timestamp: Date.now(),
    version: "2.0"
  };
});
```

## 认证与安全

```typescript
// 配置 API Key
gateway.setAuth({
  type: "api_key",
  keys: ["key1", "key2"]
});
```

## 监控

```typescript
gateway.on("message:send", (event) => {
  metrics.recordMessage(event.channel, event.status);
});

gateway.on("channel:error", (event) => {
  logger.error(`Channel error: ${event.channel}`, event.error);
});
```
