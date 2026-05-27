# 任务系统

## 概述

任务系统管理长时间运行的异步操作，提供任务的创建、监控、暂停、恢复和取消功能。

## 创建任务

```bash
# 创建后台任务
/task create "数据分析"

# 创建定时任务
/task schedule "每日报告" "0 0 9 * * *"
```

## 管理任务

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

## 任务状态

| 状态 | 说明 |
|------|------|
| pending | 等待执行 |
| running | 执行中 |
| paused | 已暂停 |
| completed | 已完成 |
| failed | 执行失败 |
| cancelled | 已取消 |

## 任务配置

```typescript
const config = {
  maxConcurrent: 5,
  defaultTimeout: 300000,
  retryOnFailure: true,
  maxRetries: 3,
  persistence: true
};
```
