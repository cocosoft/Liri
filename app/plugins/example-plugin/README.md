# example-plugin

示例插件，展示如何开发 Liri 插件，包含命令和工具实现。

## 功能

### 命令

- `hello` - 显示欢迎信息和系统状态
  - 别名: `h`, `welcome`
  - 示例: `/hello`

- `status` - 显示插件状态和统计信息
  - 别名: `s`, `stat`
  - 示例: `/status`

- `greet <name>` - 根据名称生成个性化问候
  - 别名: `g`
  - 示例: `/greet Alice`

### 工具

- `file_info` - 获取文件的详细信息
  - 参数: `file_path` (文件路径)
  - 示例: `file_info({"file_path": "package.json"})`

- `dir_size` - 计算目录的大小
  - 参数: `directory` (目录路径)
  - 示例: `dir_size({"directory": "."})`

- `system_info` - 获取系统基本信息
  - 无参数
  - 示例: `system_info({})`

## 安装

将插件放置在 `plugins/example-plugin` 目录下。

## 项目结构

```
example-plugin/
├── src/
│   ├── commands/         # 命令实现
│   │   ├── HelloCommand.ts
│   │   ├── StatusCommand.ts
│   │   └── GreetCommand.ts
│   ├── tools/            # 工具实现
│   │   ├── FileInfoTool.ts
│   │   ├── DirSizeTool.ts
│   │   └── SystemInfoTool.ts
│   ├── index.ts          # 插件入口（传统方式）
│   └── simple-index.ts   # 插件入口（简化方式，使用 createPlugin）
├── package.json          # 插件配置
├── plugin.json           # 插件元数据
└── README.md             # 本文件
```

## 使用

### 使用命令

```bash
# 显示欢迎信息
/hello

# 显示插件状态
/status

# 生成个性化问候
/greet Bob
```

### 使用工具

```bash
# 获取文件信息
file_info({"file_path": "package.json"})

# 计算目录大小
dir_size({"directory": "."})

# 获取系统信息
system_info({})
```

## 开发

### 插件开发流程

1. 创建插件目录结构
2. 实现命令和工具
3. 使用 `createPlugin` 或实现 `Plugin` 接口创建插件
4. 测试插件功能

### 两种开发方式

#### 方式一：使用 createPlugin（推荐）

使用 `createPlugin` 辅助函数，减少样板代码：

```typescript
import { createPlugin } from '../../../src/plugins/utils/createPlugin';

export default createPlugin({
  metadata: {
    name: 'my-plugin',
    version: '1.0.0',
    description: 'My plugin',
    author: 'Developer',
    type: 'tool'
  },

  async initialize(context) {
    context.log('info', 'Plugin initialized');
    context.registerTool(myTool);
    context.registerCommand(myCommand);
  },

  async start() {
    console.log('Plugin started');
  },

  async stop() {
    console.log('Plugin stopped');
  }
});
```

参考 `src/simple-index.ts` 查看完整示例。

#### 方式二：实现 Plugin 接口（传统方式）

实现完整的 `Plugin` 接口，适合需要更多控制的场景：

```typescript
import type { Plugin, PluginContext, PluginMetadata } from '../../../src/plugins/types/Plugin';
import { PluginStatus } from '../../../src/plugins/types/Plugin';

export class MyPlugin implements Plugin {
  metadata: PluginMetadata = {
    name: 'my-plugin',
    version: '1.0.0',
    description: 'My plugin',
    author: 'Developer',
    dependencies: []
  };

  status: PluginStatus = PluginStatus.REGISTERED;
  error?: Error;

  async initialize(context: PluginContext): Promise<void> {
    this.status = PluginStatus.LOADED;
  }

  async start(): Promise<void> {
    this.status = PluginStatus.ENABLED;
  }

  async stop(): Promise<void> {
    this.status = PluginStatus.DISABLED;
  }

  async unload(): Promise<void> {
    this.status = PluginStatus.REGISTERED;
  }
}
```

### 扩展插件

要添加新命令：
1. 在 `src/commands/` 目录创建新的命令类
2. 在插件入口中注册新命令

要添加新工具：
1. 在 `src/tools/` 目录创建新的工具类
2. 在插件入口中注册新工具

## 测试

```bash
# 启动 Liri 并测试插件
npm run start

# 测试命令
/hello
/status
/greet Test

# 测试工具
file_info({"file_path": "package.json"})
dir_size({"directory": "."})
system_info({})
```

## 依赖

- Liri 核心系统
- Node.js 18+

## 版本

- 当前版本: 1.0.0
- 作者: Liri Team
- 描述: An example plugin for Liri with commands and tools
