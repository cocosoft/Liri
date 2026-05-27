# Notification - 通知系统

## 概述

通知系统提供应用内通知能力，基于 React/Ink Hooks 实现，支持启动通知、插件安装通知和任务完成通知等场景。

## 通知 Hooks

```typescript
import {
  useStartupNotification,
  usePluginInstallationNotification,
  useTaskCompletionNotification,
} from "./hooks/notifs/index.js";
```

### 启动通知

```typescript
import { useStartupNotification } from "./hooks/notifs/index.js";

function App() {
  // 在组件中使用 Hook，当应用启动完成时自动触发通知
  useStartupNotification();

  return <AppContent />;
}
```

### 插件安装通知

```typescript
import { usePluginInstallationNotification } from "./hooks/notifs/index.js";

function PluginManager() {
  // 插件安装完成时弹出通知提示
  usePluginInstallationNotification();

  return <PluginList />;
}
```

### 任务完成通知

```typescript
import { useTaskCompletionNotification } from "./hooks/notifs/index.js";

function TaskRunner() {
  // 任务执行结束后自动触发通知
  useTaskCompletionNotification();

  return <TaskView />;
}
```

## 使用场景

- 应用启动时显示欢迎或状态通知
- 插件安装成功/失败的即时反馈
- 长时间运行任务完成后的提醒
- 终端 UI 中的事件驱动的消息提示
