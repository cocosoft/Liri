# 监控模块 (monitoring)

## 概述

系统监控和告警模块，提供指标采集、健康检查和遥测上报。

## 职责

- **MonitoringService** — 监控服务，管理 SystemStatus 和 MonitoringConfig
- **metrics** — 指标采集
- **health** — 健康检查
- **alerts** — 告警管理

## 集成

- 守护进程模块上报状态指标到 MonitoringService
- 日志模块（Logger）输出格式化日志

## 依赖

- core, infrastructure, error
- 可选: performance

## 使用

```typescript
import { MonitoringService } from '@modules/monitoring';
```
