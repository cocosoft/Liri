# PY_APP Core

AI Agent 核心运行时，提供 CLI 接口和基础工具集。

## 安装

```bash
npm install @pyapp/core
```

## 使用

```typescript
import { AppCore, feature, getBuildVariant } from '@pyapp/core';

const app = new AppCore();
await app.initialize();
await app.start();
```

## 模块

| 模块 | 导入路径 | 说明 |
|------|---------|------|
| 核心 | `@pyapp/core` | AppCore, CoreAPI, Feature Flags |
| 工具 | `@pyapp/core/tools` | 基础工具集（文件、搜索、任务等） |
| 通道 | `@pyapp/core/channels` | 通道管理器 + Telegram/Web 通道 |
| 转换器 | `@pyapp/core/converter` | 文件格式转换引擎 |
| UI | `@pyapp/core/ui` | Ink 终端 UI 组件 |
| 插件 SDK | `@pyapp/core/plugins/sdk` | 第三方插件开发接口 |

## 构建变体

通过环境变量控制功能集：

```bash
PYAPP_BUILD_VARIANT=core bun run start
```

| 变体 | 说明 |
|------|------|
| `core` | 最小功能集 |
| `personal` | 个人版 |
| `coding` | 编码版 |
| `enterprise` | 企业版 |