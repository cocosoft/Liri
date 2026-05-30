# Coordinator - 协调器

## 概述

Coordinator 是 Liri 的任务协调器，负责任务的创建、调度、监控和结果收集。它管理 Agent 与工具之间的交互，确保任务按预期执行。

## 核心功能

### 任务调度

```typescript
import { Coordinator } from "./core/Coordinator.js";

const coordinator = new Coordinator();

// 提交任务
const task = await coordinator.submitTask({
  type: "query",
  input: "解释什么是依赖注入",
  options: { model: "gpt-4" }
});
```

### 任务管理

```typescript
// 获取任务状态
const status = coordinator.getTaskStatus(task.id);

// 取消任务
await coordinator.cancelTask(task.id);

// 获取任务结果
const result = await coordinator.getTaskResult(task.id);
```

### 路由策略

Coordinator 支持多种路由策略：

- **优先级路由**: 高优先级任务先执行
- **负载均衡**: 在多个 Agent 间分配任务
- **亲和性路由**: 相同类型的任务路由到同一 Agent

## 事件监听

```typescript
coordinator.on("task:complete", (event) => {
  console.log(`Task ${event.taskId} completed`);
});

coordinator.on("task:error", (event) => {
  console.error(`Task ${event.taskId} failed:`, event.error);
});
```

## 配置选项

```typescript
const coordinator = new Coordinator({
  maxConcurrentTasks: 10,
  taskTimeout: 30000,
  retryOnFailure: true,
  maxRetries: 3
});
```
