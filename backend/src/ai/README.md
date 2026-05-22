# AI 模块 (ai)

## 概述

AI 功能模块，提供模型管理和 AI 服务能力。

## 职责

- **AIModelManager** — 模型管理器，统一管理 AI 模型实例
- **clients/** — AI 客户端实现（retry、thinking 等）
- **models/** — 模型类型定义
- **telemetry/** — AI 调用遥测
- **localAgent/** — 轻量级本地 Agent 支持

## 模型数据源

`ModelConfigs.ts` 是模型配置的唯一数据源，通过 `ModelManager.ts` 提供查询 API，禁止硬编码模型 ID。

## 依赖

- core, infrastructure, error

## 使用

```typescript
import { AIModelManager } from '@modules/ai';
```
