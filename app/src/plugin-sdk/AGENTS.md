# plugin-sdk 边界规则

## 核心原则

**plugin-sdk 是 Liri 为第三方插件开发者提供的唯一公开 SDK。**

### 边界红线

1. **零反向引用**：`plugin-sdk/` 内禁止引用任何 `src/` 下的其他模块（`core/`、`plugins/`、`tools/` 等）
   - 正确：`import type { X } from '@modules/plugin-sdk'`
   - 错误：`import { X } from '../../core/PluginSDK'`

2. **纯类型 + 纯函数**：SDK 中仅包含类型定义和纯工具函数，不含运行时服务依赖

3. **版本兼容**：对 SDK 公开 API 的任何破坏性变更必须：
   - 更新 `testing/plugin-sdk/api-baseline.test.ts` 中的契约测试
   - 在发布说明中标注 breaking change

### 导入路径

- 新插件/新代码使用 `@modules/plugin-sdk`
- 旧版 `@modules/plugins/sdk` 仍保留兼容导出，但新功能不再添加

### 公开 API 清单

| API                        | 来源                | 类型 |
| -------------------------- | ------------------- | ---- |
| `Plugin`                   | types.ts            | 接口 |
| `PluginContext`            | types.ts            | 接口 |
| `SkillDefinition`          | types.ts            | 接口 |
| `SkillParameter`           | types.ts            | 接口 |
| `SkillContext`             | types.ts            | 接口 |
| `PluginManifest`           | types.ts            | 接口 |
| `PluginConfig`             | types.ts            | 接口 |
| `PluginRuntime`            | types.ts            | 接口 |
| `ToolRegistration`         | types.ts            | 接口 |
| `PluginRuntimeStatus`      | types.ts            | 枚举 |
| `createPlugin()`           | core.ts             | 函数 |
| `validatePluginManifest()` | core.ts             | 函数 |
| **🆕 分类系统**            |                     |      |
| `PLUGIN_CATEGORIES`        | categories.ts       | 常量 |
| `getCategoryMeta()`        | categories.ts       | 函数 |
| `validateCategory()`       | categories.ts       | 函数 |
| `listCategories()`         | categories.ts       | 函数 |
| `createProviderPlugin()`   | categories.ts       | 函数 |
| `createToolPlugin()`       | categories.ts       | 函数 |
| `createHookPlugin()`       | categories.ts       | 函数 |
| `createChannelPlugin()`    | categories.ts       | 函数 |
| `createSkillPlugin()`      | categories.ts       | 函数 |
| `PluginCategoryCapability` | categories.ts       | 类型 |
| `ProviderPlugin`           | categories.ts       | 接口 |
| `ToolPlugin`               | categories.ts       | 接口 |
| `HookPlugin`               | categories.ts       | 接口 |
| `ChannelPlugin`            | categories.ts       | 接口 |
| `SkillPlugin`              | categories.ts       | 接口 |
| **🆕 通道契约**            |                     |      |
| `IChannelPlugin`           | channel-contract.ts | 接口 |
| `validateChannelPlugin()`  | channel-contract.ts | 函数 |
| `ChannelMeta`              | channel-contract.ts | 接口 |
| `ChannelCapabilities`      | channel-contract.ts | 接口 |
| `ChannelSendResult`        | channel-contract.ts | 接口 |
| `ChannelStatus`            | channel-contract.ts | 接口 |
| `ChannelMessageContext`    | channel-contract.ts | 接口 |

### 契约测试

每次修改 SDK 后执行：`bun test testing/plugin-sdk/`
