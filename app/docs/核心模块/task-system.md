# TaskSystem - 任务系统

## 概述

TaskSystem 管理长时间运行的任务，支持任务的创建、监控、暂停、恢复和取消。

## 基本用法

```typescript
import { TaskManager } from "./task/TaskManager.js";

const taskManager = new TaskManager();

// 创建任务
const task = await taskManager.createTask({
  name: "数据分析",
  type: "async",
  handler: async (ctx) => {
    // 长时间运行的任务
    await processData(ctx);
  }
});

// 启动任务
await taskManager.startTask(task.id);
```

## 任务状态

```text
pending → running → completed
              ↓
           paused → running
              ↓
           cancelled
              ↓
           failed
```

## 任务管理命令

```bash
# 查看所有任务
/task list

# 查看任务详情
/task show <id>

# 暂停任务
/task pause <id>

# 恢复任务
/task resume <id>

# 取消任务
/task cancel <id>

# 清除已完成的任务
/task clean
```

## 任务持久化

```typescript
// 任务结果自动持久化
const result = await taskManager.getTaskResult(task.id);

// 任务进度报告
task.on("progress", (percent) => {
  console.log(`Progress: ${percent}%`);
});
```

## 并发控制

```typescript
const taskManager = new TaskManager({
  maxConcurrent: 5,
  defaultTimeout: 300000  // 5 分钟
});
```
