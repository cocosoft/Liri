# 核心模块 (core)

## 概述

应用核心功能模块，提供基础架构和生命周期管理。

## 职责

- **AppCore** — 应用核心，协调各子系统
- **Coordinator** — 协调器，负责编排业务流程
- **DIContainer** — 依赖注入容器
- **PluginSDK** — 插件 SDK，提供插件开发接口
- **featureFlags** — 特性开关管理
- **state/** — 全局状态管理（AppState、Store）
- **config/** — 核心配置管理
- **auth/** — 认证与授权
- **context/** — 上下文管理
- **loop/TAORLoop** — TAOR 主循环驱动
- **task/** — 任务管理
- **theme/** — 主题管理
- **lazy/** — 懒加载工具

## 依赖

- 无（核心模块）

## 使用

```typescript
import { AppCore } from '@modules/core';
```
