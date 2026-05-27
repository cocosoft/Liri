# ConfigManager - 配置管理

## 概述

ConfigManager 管理应用配置，支持多层级配置源、热重载和配置变更监听。

## 基本用法

```typescript
import { ConfigManager } from "./core/config/ConfigManager.js";

const config = new ConfigManager();

// 获取配置
const port = config.get("server.port", 3000);
const logLevel = config.get<string>("logging.level");

// 设置配置
config.set("server.port", 8080);

// 获取整个配置对象
const allConfig = config.getAll();
```

## 配置源

配置按优先级从高到低：

1. **环境变量** - `.env` 文件
2. **配置文件** - `config/governance.json`
3. **默认值** - 代码中定义的默认值

## 配置热重载

```typescript
// 监听配置变更
config.on("change", (key, newValue, oldValue) => {
  console.log(`配置变更: ${key}`, oldValue, "->", newValue);
});

// 手动重新加载
await config.reload();
```

## 配置突变追踪

```typescript
// 获取变更历史
const changes = config.getChangeLog();

// 重置追踪
config.resetChangeTracking();
```

## 配置脱敏

```typescript
// 注册脱敏规则（敏感配置在日志中自动隐藏）
config.addRedactRule(/api_key|password|secret/i);
```

## 运行时覆盖

```typescript
// 临时覆盖配置（不写入文件）
config.override("logging.level", "debug");

// 清除覆盖
config.clearOverrides();
```
