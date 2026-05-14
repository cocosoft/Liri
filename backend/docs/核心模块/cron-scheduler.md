# CronScheduler - 定时任务调度

## 概述

CronScheduler 提供基于 Cron 表达式的定时任务调度能力。

## 基本用法

```typescript
import { CronScheduler } from "./core/cron/CronScheduler.js";

const scheduler = new CronScheduler();

// 注册定时任务
scheduler.schedule("每日备份", "0 0 2 * * *", async () => {
  await backupData();
});

// 注册一次性任务
scheduler.scheduleOnce("延迟任务", new Date("2025-12-31"), async () => {
  await doSomething();
});
```

## Cron 表达式

```
* * * * * *
│ │ │ │ │ │
│ │ │ │ │ └── 星期 (0-7, 0=周日)
│ │ │ │ └──── 月份 (1-12)
│ │ │ └────── 日期 (1-31)
│ │ └──────── 小时 (0-23)
│ └────────── 分钟 (0-59)
└──────────── 秒 (0-59)
```

## 任务管理

```typescript
// 列出所有任务
const tasks = scheduler.listTasks();

// 暂停任务
scheduler.pauseTask("每日备份");

// 恢复任务
scheduler.resumeTask("每日备份");

// 删除任务
scheduler.removeTask("每日备份");
```

## 任务状态

```typescript
scheduler.on("task:start", (event) => {
  console.log(`任务 ${event.taskId} 开始执行`);
});

scheduler.on("task:complete", (event) => {
  console.log(`任务 ${event.taskId} 完成，耗时 ${event.duration}ms`);
});

scheduler.on("task:error", (event) => {
  console.error(`任务 ${event.taskId} 失败:`, event.error);
});
```

## 配置

```typescript
const scheduler = new CronScheduler({
  timezone: "Asia/Shanghai",
  maxConcurrent: 3,
  autoRecovery: true
});
```
