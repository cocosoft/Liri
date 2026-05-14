# EventBus - 事件总线

## 概述

EventBus 是 PY_APP 的内部事件通信机制，允许模块之间进行解耦通信。

## 基本用法

```typescript
import { EventBus } from "./core/events/EventBus.js";

const bus = new EventBus();

// 订阅事件
bus.on("user:login", (data) => {
  console.log(`用户登录: ${data.userId}`);
});

// 发布事件
bus.emit("user:login", { userId: "123", time: Date.now() });
```

## 一次性订阅

```typescript
// 只响应一次
bus.once("app:ready", () => {
  console.log("应用就绪");
});
```

## 取消订阅

```typescript
const handler = (data) => console.log(data);
bus.on("message", handler);

// 取消特定处理器
bus.off("message", handler);

// 取消所有消息处理器
bus.removeAllListeners("message");
```

## 通配符事件

```typescript
// 监听所有 user: 开头的
bus.on("user:*", (data, eventName) => {
  console.log(`用户事件 ${eventName}:`, data);
});
```

## 内置事件

| 事件 | 说明 |
|------|------|
| `app:start` | 应用启动 |
| `app:stop` | 应用关闭 |
| `session:create` | 会话创建 |
| `session:destroy` | 会话销毁 |
| `tool:before` | 工具执行前 |
| `tool:after` | 工具执行后 |
| `error:unhandled` | 未处理错误 |

## 最佳实践

- 事件名称使用命名空间，如 `module:action`
- 避免发布大量高频事件
- 及时取消不再需要的订阅
