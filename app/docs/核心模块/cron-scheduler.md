# CronScheduler - 定时任务调度

## 概述

CronScheduler 提供基于 Cron 表达式的定时任务调度能力，支持任务的注册、触发、持久化、投递重试和生命周期管理。基于 SQLite 持久化存储。

## 架构

```
CronScheduler（核心调度器）
  ├── tick() — 每秒调度循环
  ├── runJob() — 执行单个任务（完整链路）
  ├── CronJobStore（SQLite 持久化）
  │   ├── cron_jobs 表（22 列，6 索引）
  │   └── 22 个 CRUD 方法
  ├── DeliveryQueue（投递重试队列）
  │   ├── delivery_queue 表
  │   ├── 指数退避 + 随机抖动重试
  │   └── 默认 baseRetryDelayMs=1000, maxRetryDelayMs=60000
  └── StatusTransitionGuard（状态流转守卫）
      └── CRON_JOB_STATE_TRANSITIONS 映射表
```

## 基本用法

```typescript
import { CronScheduler } from '@modules/tasks/cron/CronScheduler.js';
import { CronJobStore } from '@modules/tasks/cron/CronJobStore.js';
import { SqliteTaskStore } from '@modules/tasks/db/SqliteTaskStore.js';

const dbStore = new SqliteTaskStore({ dbPath: '/path/to/data.db' });
const jobStore = new CronJobStore(dbStore);
const scheduler = new CronScheduler(jobStore, { tickIntervalMs: 1000 });

// 启动调度器
scheduler.start();

// 注册任务
await jobStore.upsertJob({
  id: 'backup_job',
  name: '每日备份',
  cronExpression: '0 2 * * *',
  action: { type: 'command', command: 'backup' },
  state: 'scheduled',
});

// 停止调度器
scheduler.stop();
```

## 任务状态流转（5 状态）

```text
scheduled ──→ running ──→ completed
                  │
                  └──→ failed
                  │
                  └──→ paused ──→ scheduled（恢复）
```

| 状态 | 说明 |
|------|------|
| `scheduled` | 等待执行 |
| `running` | 执行中 |
| `completed` | 执行成功 |
| `failed` | 执行失败 |
| `paused` | 已暂停，可恢复 |

所有状态变更均通过 `updateJobState()` 守卫函数校验合法性。

## Cron 表达式

6 字段格式（秒 分 时 日 月 周）：

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

## CLI 命令

```bash
# 注册定时任务
/cron schedule "每日备份" "0 2 * * *" "backup"

# 列出所有定时任务
/cron list

# 停止定时任务
/cron stop <job-id>

# 手动触发定时任务
/cron trigger <job-id>

# 取消订阅/暂停
/cron unsubscribe

# 查看帮助
/cron help
```

## 投递重试机制（DeliveryQueue）

```typescript
import { DeliveryQueue } from '@modules/tasks/cron/DeliveryQueue.js';

const dq = new DeliveryQueue(jobStore, {
  baseRetryDelayMs: 1000,
  maxRetryDelayMs: 60000,
  defaultMaxAttempts: 5,
});

// 添加投递任务
await dq.enqueue({
  jobId: 'backup_job',
  target: { type: 'notification', channel: 'event_bus' },
  payload: { event: 'cron_job_triggered', jobId: 'backup_job' },
});

// 处理投递队列
await dq.processQueue();
```

## 归属机制（ownerKey / sessionKey）

每个 CronJob 支持 `ownerKey` 和 `sessionKey` 字段，用于多用户协作场景：

```typescript
const job = await jobStore.upsertJob({
  id: 'user_backup',
  ownerKey: 'user_abc',
  sessionKey: 'sess:u_abc:repl:1712345678:a1b2c3d4',
  // ...
});

// 按归属筛选
const userJobs = await jobStore.loadJobs({ ownerKey: 'user_abc' });
const sessJobs = await jobStore.loadJobs({ sessionKey: 'sess:u_abc:...' });
```
