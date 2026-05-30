# 任务系统

## 概述

任务系统管理长时间运行的后台任务（BackgroundTask），提供任务的创建、监控、状态管理、心跳保活和自动清理功能。

## 管理任务

```bash
# 查看所有后台任务（按状态分组）
/tasks

# 查看活跃任务（运行中 + 等待中）
/tasks active

# 按任务类型分组显示（type/agentType）
/tasks type

# 查看任务详情
/tasks show <task-id>

# 停止任务
/tasks stop <task-id>

# 查看统计摘要
/tasks stats

# 查看最近完成的任务（默认5条）
/tasks recent [n]

# 清理已完成的任务
/tasks clear [hours]

# 以 JSON 格式输出
/tasks --json

# 限制输出数量
/tasks --limit 10
```

## 任务状态（6 状态）

| 状态 | 说明 |
|------|------|
| `pending` | 等待执行 |
| `running` | 执行中 |
| `completed` | 已完成 |
| `failed` | 执行失败 |
| `aborted` | 已中断（被用户停止） |
| `lost` | 心跳超时丢失 |

## 统计输出示例

```
后台任务 — 总计 12 | ● 运行中 3 | ◌ 等待中 2 | ✓ 已完成 5 | ✗ 失败 1 | ○ 已中断 1
```

## 任务详情

`/tasks show <task-id>` 显示任务完整信息，包括：

- ID、Agent 类型、描述、状态
- 归属（ownerKey）和会话（sessionKey）
- 创建时间、开始时间、完成时间、耗时
- Token 用量
- 错误详情（如有）

## 心跳保活

系统每 30 秒检测一次后台任务的心跳。超过 5 分钟无心跳上报的任务自动标记为 `lost` 状态，避免僵尸任务长期占用资源。

## Cron 定时任务

定时任务管理见 [定时任务文档](./cron.md)。
