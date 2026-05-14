# AppCore - 应用核心

## 概述

AppCore 是 PY_APP 的应用核心类，负责模块的注册、初始化和生命周期管理。作为依赖注入容器和协调器之间的桥梁，AppCore 确保所有模块有序启动和关闭。

## 核心功能

### 模块注册

```typescript
import { AppCore } from "./core/AppCore.js";

const app = new AppCore();

// 注册模块
app.register("config", new ConfigManager());
app.register("session", new SessionManager());
```

### 模块解析

```typescript
// 获取已注册的模块
const config = app.resolve<ConfigManager>("config");
```

### 启动与关闭

```typescript
// 启动所有模块
await app.start();

// 优雅关闭
await app.shutdown();
```

## 生命周期

1. **注册阶段**: 所有模块注册到容器
2. **初始化阶段**: 按依赖顺序初始化模块
3. **运行阶段**: 模块提供服务
4. **关闭阶段**: 逆序关闭模块

## 与 DIContainer 的关系

AppCore 内部维护一个 DIContainer 实例，通过 `register` 和 `resolve` 方法封装容器操作，提供更高级的模块生命周期管理能力。
