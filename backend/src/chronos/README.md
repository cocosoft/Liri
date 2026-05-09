# 时间管理模块 (chronos)

## 概述

任务调度和定时功能模块，提供 Cron 表达式兼容的定时任务能力。

## 职责

- **CronTasks** — Cron 任务定义
- **cron** — Cron 表达式解析和执行
- **engine/** — 调度引擎
- **types** — 时间任务类型定义

## 集成

守护进程模块可选依赖 chronos，实现定时任务调度。

## 依赖

- core, infrastructure

## 使用

```typescript
import { CronTasks } from '@modules/chronos';
```
