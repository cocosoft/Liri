# Error Handling - 错误处理

## 概述

错误处理模块提供统一的错误处理机制，包括自定义错误类型、错误码和错误上报。

## 自定义错误

```typescript
import { AppError } from "./core/error/AppError.js";

// 抛出业务错误
throw new AppError("VALIDATION_ERROR", "输入参数无效", {
  field: "email",
  value: "invalid"
});

// 抛出系统错误
throw new AppError("CONFIG_MISSING", "缺少配置项", {
  key: "AI_API_KEY"
});
```

## 错误码

| 错误码 | 说明 |
|--------|------|
| VALIDATION_ERROR | 参数验证失败 |
| CONFIG_MISSING | 缺少配置 |
| RESOURCE_NOT_FOUND | 资源不存在 |
| PERMISSION_DENIED | 权限不足 |
| RATE_LIMIT_EXCEEDED | 频率限制 |
| TOOL_EXECUTION_ERROR | 工具执行错误 |
| INTERNAL_ERROR | 内部错误 |

## 全局错误处理

```typescript
import { ErrorHandler } from "./core/error/ErrorHandler.js";

const handler = new ErrorHandler();

// 注册全局处理器
handler.registerGlobalHandler((error) => {
  logger.error("未捕获的异常", error);
});

// 配置恢复策略
handler.setRecoveryStrategy({
  maxRetries: 3,
  backoff: "exponential",
  onRetry: (attempt) => logger.warn(`重试第 ${attempt} 次`)
});
```

## 错误上报

```typescript
// 自动收集并上报错误
handler.enableReporting({
  endpoint: "https://reporting.example.com/errors",
  batchSize: 10,
  interval: 60000
});
```

## 最佳实践

- 使用自定义错误码而非原始 Error
- 记录充分的错误上下文
- 实施优雅降级而非直接崩溃
