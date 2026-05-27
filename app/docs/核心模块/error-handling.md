# Error Handling - 错误处理

## 概述

错误处理模块提供统一的错误处理机制，包括自定义错误类型、错误码和错误上报。

## 自定义错误

```typescript
import { AppError, ErrorCategory, ErrorSeverity } from "./error/types.js";

// 抛出业务错误
throw new AppError(
  "输入参数无效",
  ErrorCategory.VALIDATION,
  ErrorSeverity.MEDIUM,
  "VALIDATION_ERROR",
  { field: "email", value: "invalid" }
);

// 抛出系统错误
throw new AppError(
  "缺少配置项",
  ErrorCategory.CONFIG,
  ErrorSeverity.HIGH,
  "CONFIG_MISSING",
  { key: "AI_API_KEY" }
);
```

## 错误分类

| 分类 | 说明 |
|------|------|
| VALIDATION | 参数验证失败 |
| CONFIG | 配置错误 |
| RESOURCE | 资源不足或不可用 |
| PERMISSION | 权限不足 |
| NETWORK | 网络错误 |
| TOOL | 工具执行错误 |
| INTERNAL | 内部错误 |

## 最佳实践

- 使用自定义错误码而非原始 Error
- 记录充分的错误上下文
- 实施优雅降级而非直接崩溃
- 通过 `error/types.ts` 扩展自定义错误类型
