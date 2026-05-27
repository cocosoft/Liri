# 错误处理模块 (error)

## 概述

错误处理基础设施模块，提供标准化错误分类和处理能力。

## 职责

- **ErrorCodes** — 错误码定义体系（按功能域分类）
- **AppError** — 应用异常基类，支持 fromCode() 工厂
- **ErrorHandler** — 错误处理器，支持重试/回退策略
- **ErrorManager** — 错误管理器
- **api/** — API 场景错误处理
- **network/** — 网络层错误处理
- **context/** — 错误上下文增强

## 核心规范

- 禁止抛出裸 Error，必须使用 AppError
- 错误信息：用户端中文展示、日志端英文记录
- 禁止空 catch 块

## 依赖

- core

## 使用

```typescript
import { AppError } from '@modules/error/types';
import { ErrorCodes } from '@modules/error/ErrorCodes';

throw AppError.fromCode(ErrorCodes.TOOL_EXEC_FAILED, {
  module: 'ToolExecutor',
  context: { toolName },
});
```
