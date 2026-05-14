# State Management - 状态管理

## 概述

State Management 模块管理应用的运行时状态，提供状态变更追踪、订阅和持久化功能。

## 基本用法

```typescript
import { AppStateManager } from "./core/state/stateManager.js";

const stateManager = new AppStateManager();

// 更新状态
stateManager.updateState("user.language", "zh-CN");

// 获取状态
const lang = stateManager.getState("user.language");

// 订阅状态变更
const unsubscribe = stateManager.subscribe("user.*", (path, value) => {
  console.log(`状态 ${path} 变更为:`, value);
});

// 取消订阅
unsubscribe();
```

## 状态路径

```typescript
// 使用点号语法访问嵌套状态
stateManager.updateState("session.123.messages", []);
stateManager.updateState("config.theme", "dark");

// 获取部分状态
const sessionState = stateManager.getState("session");
```

## 状态持久化

```typescript
// 保存状态到文件
await stateManager.persist();

// 从文件恢复
await stateManager.restore();

// 设置自动保存
stateManager.setAutoSave({ interval: 30000 });
```

## 状态快照

```typescript
// 创建快照
const snapshot = stateManager.createSnapshot();

// 恢复到快照
stateManager.restoreSnapshot(snapshot);
```

## 性能优化

- 使用路径通配符批量订阅
- 状态变更批量处理
- 自动清理过期状态
