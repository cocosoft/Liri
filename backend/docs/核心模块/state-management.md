# State Management - 状态管理

## 概述

State Management 模块管理应用的运行时状态，提供状态存储、变更订阅和全局访问能力，位于 `core/state/`。

## 基本用法

```typescript
import { createAppStateStore, getGlobalStore } from "./core/state/index.js";

// 创建带初始状态的状态存储
const store = createAppStateStore({
  user: { language: "zh-CN" },
  config: { theme: "light" },
  sessions: {}
});

// 获取当前状态
const state = store.getState();
console.log(state.user.language); // "zh-CN"
```

## 更新状态

```typescript
// 通过更新函数修改状态
store.setState((prev) => ({
  ...prev,
  user: { ...prev.user, language: "en-US" }
}));
```

## 订阅状态变更

```typescript
// 订阅状态变化
const unsubscribe = store.subscribe((newState) => {
  console.log("状态已更新:", newState);
});

// 取消订阅
unsubscribe();
```

## 全局状态存储

```typescript
import { initializeGlobalStore } from "./core/state/index.js";

// 初始化全局状态存储（应用启动时）
initializeGlobalStore({
  version: "1.0.0",
  startedAt: Date.now(),
  user: null,
  config: { theme: "dark" },
  sessions: {},
  notifications: [],
  speculation: null
});

// 在任意位置获取全局状态
const globalStore = getGlobalStore();
const config = globalStore.getState().config;
```

## 批处理更新

状态存储支持批量更新模式，多个状态变更合并为一次通知：

```typescript
// 批量更新示例
store.setState((prev) => ({
  ...prev,
  sessions: { ...prev.sessions, active: "session_1" },
  user: { ...prev.user, lastActive: Date.now() }
}));
```
