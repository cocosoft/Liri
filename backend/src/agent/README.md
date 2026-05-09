# 代理模块 (agent)

## 概述

AI 代理功能模块，提供代理管理和执行能力。

## 职责

- **AgentRunner** — 代理运行器
- **agent** — 代理核心逻辑
- **builtin/** — 内置代理类型
- **remote/** — 远程代理支持
- **swarms/** — 多代理协同（Swarm）
- **models/** — 代理类型定义

## 功能特性

- 子代理类型管理
- 后台运行支持
- 进度追踪
- 工作树隔离

## 依赖

- core, ai, error
- 可选: memory, permission

## 使用

```typescript
import { AgentRunner } from '@modules/agent';
```
