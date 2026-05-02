# 工具管理模块 (tools)

**模块分类**: 工具模块 (tools)
**模块标识**: `tools`
**版本**: 1.0.0
**对标目标**: CC (Claude Code)

---

## 1. 模块概述

工具管理模块是 PY_APP 的核心模块之一，负责管理系统中的所有工具，包括工具的注册、创建、执行、权限管理和结果处理。

### 1.1 核心功能

- **工具注册与发现**: 通过 `ToolRegistry` 管理所有可用工具
- **工具工厂**: 通过 `ToolFactory` 统一创建工具实例
- **工具编排**: 通过 `ToolOrchestration` 支持并发执行和依赖解析
- **结果预算控制**: 通过 `ToolResultBudget` 防止上下文溢出
- **中断执行支持**: 通过 `InterruptibleToolExecutor` 支持执行中断

### 1.2 依赖关系

```
core → infrastructure → tools
                      ↓
                  commands
```

- **直接依赖**: `core`, `infrastructure`, `error`
- **可选依赖**: `memory`

---

## 2. 目录结构

```
src/tools/
├── index.ts                      # 模块入口文件
├── types/                        # 类型定义
│   ├── Tool.ts                   # 工具基础类型
│   ├── ToolResult.ts             # 工具结果类型
│   ├── ToolTypes.ts              # 工具系统类型
│   └── index.ts                  # 类型导出
├── services/                    # 服务层
│   ├── ToolOrchestration.ts     # 工具编排服务
│   ├── ToolResultBudget.ts       # 结果预算控制
│   └── InterruptibleToolExecutor.ts  # 可中断执行器
├── utils/                        # 工具函数
│   └── ToolFeatureFlags.ts       # Feature Flags 配置
├── ToolFactory.ts                # 工具工厂
├── ToolManager.ts                # 工具管理器
├── ToolRegistry.ts               # 工具注册表
├── [ToolName]/                   # 各工具实现目录
│   ├── [ToolName].ts
│   ├── index.ts
│   └── UI.tsx (可选)
└── README.md                     # 本文档
```

---

## 3. Feature Flags

工具模块使用 Feature Flags 控制工具的启用/禁用。

### 3.1 配置文件

**文件**: `src/tools/utils/ToolFeatureFlags.ts`

```typescript
import { isToolEnabled, TOOL_FEATURE_FLAGS } from '@modules/tools/utils/ToolFeatureFlags';

// 检查工具是否启用
if (isToolEnabled('ENABLE_SEND_MESSAGE')) {
  // 创建并注册 SendMessageTool
}
```

### 3.2 可用标志

| 标志名 | 默认值 | 描述 |
|--------|--------|------|
| `ENABLE_SEND_MESSAGE` | `false` | 消息发送工具 |
| `ENABLE_TEAM_CREATE` | `false` | 团队创建工具 |
| `ENABLE_TEAM_DELETE` | `false` | 团队删除工具 |
| `ENABLE_SLEEP` | `false` | 延迟工具 |
| `ENABLE_MONITOR` | `false` | 监控工具 |
| `ENABLE_SEND_USER_FILE` | `false` | 用户文件发送工具 |
| `ENABLE_PUSH_NOTIFICATION` | `false` | 推送通知工具 |
| `ENABLE_SUBSCRIBE_PR` | `false` | PR 订阅工具 |
| `ENABLE_SNIP` | `false` | 历史快照工具 |
| `ENABLE_TOOL_SEARCH` | `true` | 工具搜索工具 |

---

## 4. 服务注册

新服务必须在 `ModuleDefinitions.ts` 中注册：

```typescript
// src/modules/ModuleDefinitions.ts
'tools': {
  id: 'tools',
  name: 'tools',
  displayName: '工具管理模块',
  version: '1.0.0',
  category: ModuleCategory.TOOLS,
  description: '工具管理模块，提供工具注册和执行功能',
  dependencies: ['core', 'infrastructure', 'error'],
  optionalDependencies: ['memory'],
  services: [
    {
      name: 'ToolOrchestration',
      path: '@modules/tools/services/ToolOrchestration',
      singleton: true,
    },
    {
      name: 'ToolResultBudgetManager',
      path: '@modules/tools/services/ToolResultBudget',
      singleton: true,
    },
    {
      name: 'InterruptibleToolExecutor',
      path: '@modules/tools/services/InterruptibleToolExecutor',
      singleton: false,
    },
  ],
},
```

---

## 5. 导入规范

### 5.1 必须使用别名路径

```typescript
// ✅ 正确
import { Tool } from '@modules/tools/types/Tool';
import { ToolManager } from '@modules/tools/ToolManager';
import { ToolOrchestration } from '@modules/tools/services/ToolOrchestration';
import { ModuleError } from '@modules/errors';

// ❌ 错误
import { Tool } from '../../tools/types/Tool';
import { ToolManager } from '../ToolManager';
```

### 5.2 工具工厂使用

```typescript
import { ToolFactory, getAllBaseTools } from '@modules/tools/ToolFactory';

const factory = new ToolFactory();
const tools = getAllBaseTools(); // 获取所有启用的工具
```

---

## 6. 错误处理

所有错误必须使用 `ModuleError` 类型：

```typescript
import { ModuleError } from '@modules/errors';

try {
  const tool = toolRegistry.get(toolName);
  if (!tool) {
    throw new ModuleError(
      `工具不存在: ${toolName}`,
      'tools',
      'TOOL_NOT_FOUND'
    );
  }
} catch (error) {
  if (error instanceof ModuleError) {
    throw error;
  }
  throw new ModuleError(
    `工具执行失败: ${error instanceof Error ? error.message : String(error)}`,
    'tools',
    'TOOL_EXECUTION_ERROR'
  );
}
```

---

## 7. 新增工具开发流程

### 7.1 创建工具目录

```
src/tools/[ToolName]/
├── [ToolName].ts    # 工具实现
├── index.ts         # 导出
└── UI.tsx           # UI组件（可选）
```

### 7.2 实现工具类

```typescript
// src/tools/SendMessageTool/SendMessageTool.ts
import { Tool, ToolResult } from '@modules/tools/types/Tool';
import { createToolResult } from '@modules/tools/types/ToolResult';

export class SendMessageTool implements Tool {
  name = 'SendMessage';
  description = '发送消息给用户';

  async execute(input: any, context: any): Promise<ToolResult> {
    // 实现逻辑
    return createToolResult(null, { content: '消息已发送' });
  }
}
```

### 7.3 添加 Feature Flag

在 `src/tools/utils/ToolFeatureFlags.ts` 中添加：

```typescript
ENABLE_SEND_MESSAGE: {
  name: 'SendMessageTool',
  envVar: 'FEATURE_ENABLE_SEND_MESSAGE',
  description: '启用消息发送工具',
  defaultEnabled: false,
},
```

### 7.4 在工厂中注册

在 `src/tools/ToolFactory.ts` 中添加创建方法：

```typescript
createSendMessageTool(): Tool | null {
  if (!isToolEnabled('ENABLE_SEND_MESSAGE')) return null;
  try {
    return new SendMessageTool();
  } catch (error) {
    console.error('Failed to create SendMessageTool:', error);
    return null;
  }
}
```

---

## 8. 验证命令

```bash
# 验证模块依赖关系
bun run modules:validate

# 完整检查
bun run modules:check

# 分析模块状态
bun run modules:analyze
```

---

## 9. 相关文档

- [模块开发规范](../docs/模块开发规范.md)
- [模块管理使用指南](../docs/模块管理使用指南.md)
- [工具模块对标分析报告](../../dev_docs/20260430/模块对标/工具模块对标分析报告.md)
- [工具模块实施方案](../../dev_docs/20260430/模块对标/工具模块实施方案.md)

---

**版本**: 1.0.0
**更新日期**: 2026-05-01
