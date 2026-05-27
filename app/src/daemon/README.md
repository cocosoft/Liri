# 守护进程模块 (daemon)

## 概述

后台守护进程子系统，提供进程生命周期管理、任务调度和进程间通信。

## 职责

- **ProcessManager** — 进程管理器，负责进程注册、启停、健康检查和自动重启
- **TaskQueue** — 优先级任务队列，支持取消、超时、重试和进度回调
- **IPCService** — HTTP 通信层，支持 Windows 兼容的进程间消息传递

## 架构原则

- 进程崩溃自动重启（不超过 5 次/分钟）
- 优雅关闭超时 ≤ 30 秒
- 任务进度可查询（0-100%）
- 后台任务通过 AbortController 支持取消

## 依赖

- core, monitoring
- 可选: chronos（定时任务集成）

## 使用

```typescript
import { ProcessManager, TaskQueue, IPCService } from '@modules/daemon';
```
