# TaskSystem - 任务系统

## 概述

TaskSystem 管理长时间运行的后台任务（BackgroundTask），包括任务的创建、监控、状态管理、心跳保活和自动清理。基于 `TaskRegistry` + `BaseTask` 继承体系实现。

## 架构

```
TaskRegistry（注册表中心）
  ├── BaseTask（任务基类）
  │   ├── LocalBashTask（本地 bash 执行）
  │   ├── DreamTask（AI Agent 任务）
  │   ├── NoteTask（笔记任务）
  │   └── LocalMainSessionTask（主会话任务）
  ├── HeartbeatManager（心跳保活）
  ├── TaskAuditService（审计服务）
  ├── TaskReconciliationService（一致性核对）
  ├── TaskMaintenanceService（维护清理）
  └── ITaskStore（持久化存储层）
      ├── JsonTaskStore（JSON 文件存储）
      └── SqliteTaskStore（SQLite 存储）
```

## 任务状态（6 状态）

```text
pending ──→ running ──→ completed
               │
               ├──→ failed
               ├──→ killed
               └──→ lost（心跳超时）
```

| 状态 | 说明 |
|------|------|
| `PENDING` | 等待执行，初始状态 |
| `RUNNING` | 执行中，有心跳上报 |
| `COMPLETED` | 正常完成 |
| `FAILED` | 执行失败 |
| `KILLED` | 被用户中断 |
| `LOST` | 心跳超时，任务丢失 |

## 任务管理命令

```bash
# 查看所有后台任务（按状态分组）
/tasks

# 查看活跃任务（运行中 + 等待中）
/tasks active

# 按任务类型分组显示
/tasks type

# 查看任务详情
/tasks show <task-id>

# 停止任务
/tasks stop <task-id>

# 查看统计摘要
/tasks stats

# 清理已完成的任务
/tasks clear [hours]

# 以 JSON 格式输出
/tasks --json
```

## 核心模块

### TaskRegistry

任务注册表，管理所有 BaseTask 的生命周期：

```typescript
import { taskRegistry } from '@modules/tasks/TaskRegistry.js';

// 注册任务
taskRegistry.register(task);

// 获取任务
const task = taskRegistry.getTask(taskId);

// 按状态查询
const runningTasks = taskRegistry.getTasksByStatus(TaskStatus.RUNNING);

// 按归属查询
const userTasks = taskRegistry.getTasksByOwnerKey('user_abc');

// 按会话查询
const sessTasks = taskRegistry.getTasksBySessionKey('sess:user:chat:...');

// 获取统计
const stats = taskRegistry.getTaskStats();
// => { total, pending, running, completed, failed, killed, lost }
```

### HeartbeatManager

心跳保活，自动检测超时丢失的任务：

```typescript
import { HeartbeatManager } from '@modules/tasks/heartbeat/index.js';

const hb = new HeartbeatManager({ defaultTtlMs: 300000 });

// 注册任务心跳
hb.register('taskId', { pid: 12345 });

// 上报心跳
hb.beat('taskId');

// 立即检测超时
const staleTasks = hb.detectTimeout();

// 自动检测（每 30 秒）
hb.startAutoDetect();

// 监听超时事件
hb.on('timeout', ({ taskId, ageMs }) => {
  console.log(`任务 ${taskId} 已超时 ${ageMs}ms`);
});
```

### ITaskStore 持久化接口

统一存储抽象层，支持双模式：

```typescript
interface ITaskStore {
  loadTaskStates(): Promise<TaskState[]>;
  saveTaskState(state: TaskState): Promise<void>;
  deleteTaskState(taskId: string): Promise<void>;
  healthCheck(): Promise<boolean>;
}
```

## 审计与一致性

```typescript
import { TaskAuditService } from '@modules/tasks/TaskAuditService.js';

const auditor = new TaskAuditService(taskRegistry);
const report = await auditor.runAudit();
// report.issues: orphan_subtask | stuck_running | inconsistent_status | missing_parent
// report.summary: { orphanCount, stuckCount, inconsistentCount }
```

## Cron 定时任务

参见 [CronScheduler 文档](./cron-scheduler.md) 和 [定时任务用户指南](../../自动化/cron.md)。
