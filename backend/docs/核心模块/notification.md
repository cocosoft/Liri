# Notification - 通知系统

## 概述

通知系统提供消息通知能力，支持多渠道通知分发、通知模板和通知偏好管理。

## 基本用法

```typescript
import { NotificationService } from "./core/notification/index.js";

const notifier = new NotificationService();

// 发送通知
await notifier.send({
  title: "任务完成",
  body: "数据分析任务已完成",
  channel: "discord"
});
```

## 通知渠道

```typescript
// 注册通知渠道
notifier.registerChannel("email", {
  send: async (notification) => {
    await sendEmail(notification);
  }
});

// 配置多路分发
await notifier.sendBroadcast(notification, ["discord", "slack", "email"]);
```

## 通知模板

```typescript
// 注册模板
notifier.registerTemplate("task_complete", {
  title: "任务 {{taskName}} 已完成",
  body: "耗时 {{duration}} 秒"
});

// 使用模板
await notifier.sendWithTemplate("task_complete", {
  taskName: "数据分析",
  duration: 45
});
```

## 通知偏好

```typescript
// 用户通知偏好
const preferences = {
  discord: { enabled: true, quiet: false },
  email: { enabled: true, digest: "daily" },
  sms: { enabled: false }
};

await notifier.updatePreferences(userId, preferences);
```

## 通知队列

```typescript
// 通知进入队列，异步发送
await notifier.enqueue(notification);

// 队列处理状态
notifier.on("sent", (event) => console.log(`通知已发送: ${event.id}`));
notifier.on("failed", (event) => console.error(`通知发送失败: ${event.id}`));
```
