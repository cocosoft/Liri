# DIContainer - 依赖注入容器

## 概述

依赖注入容器（DIContainer）用于管理应用中的服务依赖关系，支持单例和工厂模式。

## 基本用法

```typescript
import { DIContainer } from "./core/DIContainer.js";

const container = new DIContainer();

// 注册服务工厂
container.register("userService", () => new UserService());

// 注册服务实例（单例）
container.registerInstance("dbConnection", new DatabaseConnection());

// 解析服务
const userService = container.resolve("userService");
const db = container.resolve("dbConnection");
```

## 服务管理

```typescript
// 检查服务是否存在
if (container.has("userService")) {
  console.log("UserService is registered");
}

// 注销服务
container.unregister("userService");

// 清空所有服务
container.clear();
```

## 依赖注入

```typescript
// 自动解析依赖
container.register("repository", () => {
  const db = container.resolve("dbConnection");
  return new Repository(db);
});
```

## 最佳实践

- 使用 `registerInstance` 注册需要全局共享的单例
- 使用 `register` 注册需要延迟创建的工厂
- 避免循环依赖
- 在应用启动阶段完成所有注册
