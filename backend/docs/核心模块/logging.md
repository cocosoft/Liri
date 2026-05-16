# Logging - 日志系统

## 概述

日志系统提供结构化日志记录能力，支持多种日志级别、输出目标和格式化方式。

## 基本用法

```typescript
import { Logger } from "./core/logger/index.js";

const logger = new Logger({ name: "app" });

// 不同级别的日志
logger.debug("调试信息");
logger.info("应用启动");
logger.warn("资源使用率较高");
logger.error("发生错误", error);
```

## 日志级别

| 级别 | 值 | 说明 |
|------|-----|------|
| DEBUG | 0 | 调试信息 |
| INFO | 1 | 一般信息 |
| WARN | 2 | 警告 |
| ERROR | 3 | 错误 |
| FATAL | 4 | 致命错误 |

## 日志配置

```typescript
const logger = new Logger({
  name: "app",
  level: "info",
  format: "json",          // json, text, pretty
  transports: ["console", "file"],
  outputPath: "logs/app.log",
  maxFileSize: "10MB",
  maxFiles: 7
});
```

## 结构化日志

```typescript
logger.info("用户操作", {
  userId: "123",
  action: "login",
  ip: "192.168.1.1",
  duration: 150
});
```

## 日志脱敏

```typescript
// 配置脱敏规则
logger.addSanitizer(/password|token|secret/gi, "***");

// 自动脱敏敏感字段
logger.info("API 请求", { apiKey: "sk-xxx" });
// 输出: { apiKey: "***" }
```
