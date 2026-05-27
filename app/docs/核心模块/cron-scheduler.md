# CronScheduler - 定时任务调度

## 概述

CronScheduler 提供基于 Cron 表达式的定时任务调度能力。

## 基本用法

```typescript
import {
  addCronTask, removeCronTasks, listAllCronTasks,
  parseCronExpression, computeNextCronRun
} from "./chronos/index.js";

// 添加定时任务
await addCronTask({
  name: "每日备份",
  taskId: "backup_task",
  cron: "0 2 * * *",
  handler: async () => { await backupData(); }
});

// 解析 Cron 表达式
const parsed = parseCronExpression("0 2 * * *");
console.log(parsed); // { minute: 0, hour: 2, dayOfMonth: '*', ... }

// 计算下次执行时间
const nextRun = computeNextCronRun("0 2 * * *", Date.now());
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
const tasks = listAllCronTasks();

// 删除任务
await removeCronTasks("backup_task");

// 标记任务已触发
import { markCronTasksFired } from "./chronos/index.js";
await markCronTasksFired("backup_task");

// 查找错过的任务
import { findMissedTasks } from "./chronos/index.js";
const missed = await findMissedTasks();
```

## 任务状态

任务状态通过 `ChronosDatabase` 持久化，支持查询任务执行历史：

```typescript
import { ChronosDatabase } from "./chronos/index.js";

const db = new ChronosDatabase();
const history = db.getTaskHistory("backup_task");
```
