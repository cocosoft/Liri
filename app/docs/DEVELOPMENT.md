# 开发指南

## 项目结构

```
Liri/app/
├── src/                  # 源代码
│   ├── agent/            # AI代理模块
│   ├── ai/               # AI模型API集成
│   ├── analytics/        # 分析系统
│   ├── bootstrap/        # 启动引导
│   ├── bridge/           # 桥接层（CLI/REPL）
│   ├── buddy/            # 伙伴系统
│   ├── cache/            # 缓存系统
│   ├── channels/         # 消息渠道
│   ├── chat/             # 聊天功能
│   ├── chronos/          # 定时任务和自动化
│   ├── cli/              # 命令行接口
│   ├── commands/         # 命令系统
│   ├── common/           # 公共常量与类型
│   ├── config/           # 配置管理
│   ├── constants/        # 系统常量
│   ├── core/             # 核心功能
│   │   ├── DIContainer.ts  # 依赖注入容器
│   │   ├── Coordinator.ts  # 任务协调器
│   │   ├── state/          # 状态管理
│   │   ├── task/           # 核心任务
│   │   ├── theme/          # 主题系统
│   │   └── AppCore.ts      # 应用核心
│   ├── cost/             # 成本追踪
│   ├── credentials/      # 凭据管理
│   ├── daemon/           # 守护进程
│   ├── docs/             # 文档系统（API文档、帮助系统）
│   ├── entrypoints/      # 入口点
│   ├── error/            # 错误处理
│   ├── flows/            # 流程引擎
│   ├── hooks/            # 钩子系统
│   ├── keybindings/      # 快捷键
│   ├── lsp/              # LSP 客户端
│   ├── mcp/              # MCP 协议支持
│   ├── media/            # 媒体处理
│   ├── memory/           # 记忆系统
│   ├── modules/          # 模块管理
│   ├── monitoring/       # 监控系统
│   ├── oauth/            # OAuth 认证
│   ├── performance/      # 性能优化
│   ├── permission/       # 权限管理
│   ├── plugin-sdk/       # 插件 SDK
│   ├── plugins/          # 插件系统
│   ├── query/            # 查询引擎
│   ├── sandbox/          # 沙箱环境
│   ├── security/         # 安全性增强
│   ├── services/         # 应用服务
│   ├── session/          # 会话管理
│   ├── skills/           # 技能系统
│   ├── streaming/        # 流式处理
│   ├── task/             # 任务管理系统
│   ├── tasks/            # 任务实现
│   ├── tools/            # 工具链
│   ├── types/            # 公共类型定义
│   ├── ui/               # 用户界面
│   ├── utils/            # 工具函数
│   ├── vim/              # Vim 模式
│   └── index.ts          # 主入口
├── docs/                 # 文档
│   ├── index.md          # 文档索引
│   ├── API.md            # API文档
│   └── DEVELOPMENT.md    # 开发指南
├── logs/                 # 日志
├── testing/              # 测试
├── package.json          # 项目配置
├── tsconfig.json         # TypeScript配置
├── Dockerfile            # Docker配置
├── docker-compose.yml    # Docker Compose配置
├── deploy.sh             # 部署脚本
└── .env.example          # 环境变量模板
```

## 开发环境设置

### 安装依赖

```bash
bun install
```

### 环境变量

创建 `.env` 文件，添加以下配置：

```env
# OpenAI API 密钥
OPENAI_API_KEY=your_openai_api_key

# Anthropic API 密钥
ANTHROPIC_API_KEY=your_anthropic_api_key

# 环境变量
NODE_ENV=development
```

### 开发命令

```bash
# 开发模式（自动重载）
bun run dev

# 类型检查
bun run typecheck

# 代码检查
bun run lint

# 代码格式化
bun run format

# 运行测试
bun run test

# 构建
bun run build

# 健康检查
bun run health

# 监控面板
bun run monitor

# 部署
bun run deploy

# Docker部署
bun run deploy:docker

# 停止Docker
bun run stop:docker
```

## 代码风格

### TypeScript

- 使用 TypeScript 进行开发
- 遵循 ESLint 和 Prettier 规则
- 使用函数级注释
- 保持代码可读性

### 命名规范

- **变量和函数**：使用驼峰命名法（camelCase）
- **类和接口**：使用 Pascal 命名法（PascalCase）
- **常量**：使用大写蛇形命名法（UPPER_SNAKE_CASE）
- **私有成员**：使用下划线前缀（_privateMember）

### 代码组织

- 每个模块应该有清晰的职责
- 使用目录结构来组织代码
- 避免代码重复
- 优先使用组合而非继承

## 模块开发

### 创建新模块

1. 在 `src` 目录下创建新的目录
2. 创建 `index.ts` 文件作为模块入口
3. 实现模块功能
4. 在 `src/index.ts` 中导出模块

### 示例：创建新工具

```typescript
// src/tools/MyTool/MyTool.ts
import { Tool } from '../types';

export class MyTool {
  static create(): Tool {
    return {
      name: 'my_tool',
      description: 'My custom tool',
      params: [
        {
          name: 'param1',
          type: 'string',
          description: 'Parameter 1',
          required: true
        }
      ],
      execute: async (input, context) => {
        // 实现工具逻辑
        return { result: 'Tool executed' };
      }
    };
  }
}

// src/tools/ToolFactory.ts
import { MyTool } from './MyTool/MyTool';

// ...

createMyTool(): Tool {
  return MyTool.create();
}

// src/tools/ToolManager.ts
loadBuiltinTools(): void {
  const builtinTools: Tool[] = [
    // ...
    this.factory.createMyTool(),
  ];
  this.registry.registerTools(builtinTools);
}
```

### 示例：创建新命令

```typescript
// src/commands/builtin/mycommand/MyCommand.ts
import { Command } from '../../types';

export class MyCommand implements Command {
  name = 'mycommand';
  description = 'My custom command';
  aliases = ['mc'];
  options = [];

  async execute(args: string[], options: any): Promise<void> {
    // 实现命令逻辑
    console.log('My command executed');
  }
}

// src/commands/builtin/index.ts
export * from './mycommand';

// src/commands/loader/CommandLoader.ts
// 命令会自动加载
```

### 示例：创建新技能

```typescript
// src/skills/math/add.ts
import { Skill, SkillContext, SkillResult } from '../types';

export const add: Skill = {
  metadata: {
    name: 'math.add',
    description: 'Add two numbers',
    category: 'math',
    tags: ['calculation', 'basic'],
    version: '1.0.0',
    author: 'Liri'
  },
  execute: async (input: { a: number; b: number }, context: SkillContext): Promise<SkillResult> => {
    const result = input.a + input.b;
    return {
      success: true,
      data: result,
      message: `Added ${input.a} and ${input.b} to get ${result}`
    };
  }
};

// 技能会自动被技能加载器加载
```

### 示例：创建新主题

```typescript
// src/core/theme.ts
export const customTheme: Theme = {
  name: 'custom',
  description: 'Custom theme',
  colors: {
    primary: '#00ff00',
    secondary: '#00cc00',
    success: '#00ff00',
    warning: '#ffcc00',
    error: '#ff0000',
    info: '#00ccff',
    text: '#ffffff',
    background: '#000000',
    border: '#333333',
    highlight: '#00ff00'
  },
  styles: {
    header: (text: string) => `\x1b[1;32m${text}\x1b[0m`,
    title: (text: string) => `\x1b[1;32m${text}\x1b[0m`,
    subtitle: (text: string) => `\x1b[32m${text}\x1b[0m`,
    success: (text: string) => `\x1b[32m✓ ${text}\x1b[0m`,
    warning: (text: string) => `\x1b[33m⚠ ${text}\x1b[0m`,
    error: (text: string) => `\x1b[31m✗ ${text}\x1b[0m`,
    info: (text: string) => `\x1b[36mℹ ${text}\x1b[0m`,
    code: (text: string) => `\x1b[36m${text}\x1b[0m`,
    prompt: (text: string) => `\x1b[1;32m${text}\x1b[0m`,
    progress: (text: string) => `\x1b[32m${text}\x1b[0m`
  }
};

// 在主题管理器中注册
```

## 测试

### 单元测试

在 `src` 目录下创建 `__tests__` 目录，编写单元测试：

```typescript
// src/utils/__tests__/cache.test.ts
import { Cache } from '../cache';

describe('Cache', () => {
  test('should set and get value', () => {
    const cache = new Cache({ ttl: 1000 });
    cache.set('key', 'value');
    expect(cache.get('key')).toBe('value');
  });

  test('should expire value', async () => {
    const cache = new Cache({ ttl: 100 });
    cache.set('key', 'value');
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(cache.get('key')).toBeUndefined();
  });
});
```

### 集成测试

在 `app/testing` 目录下创建集成测试：

```typescript
// app/testing/integration.test.ts
import { aiService, chatService } from '../src';

describe('Integration Tests', () => {
  test('should generate response from AI service', async () => {
    const response = await aiService.generate([
      { role: 'user', content: 'Hello' }
    ]);
    expect(response.content).toBeTruthy();
  });

  test('should create chat session', async () => {
    const session = chatService.createSession({
      name: 'Test Session',
      model: 'gpt-3.5-turbo'
    });
    expect(session.getId()).toBeTruthy();
  });
});
```

## 部署

### 构建

```bash
bun run build
```

### 部署到服务器

1. 将 `dist` 目录复制到服务器
2. 设置环境变量
3. 启动服务：

```bash
bun run start
```

### Docker 部署

使用 Dockerfile：

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN npm run build

EXPOSE 3000

ENV NODE_ENV=production

CMD ["npm", "start"]
```

构建和运行：

```bash
# 使用docker-compose
bun run deploy:docker

# 或者手动构建和运行
docker build -t Liri .
docker run -p 3000:3000 --env-file .env Liri

# 停止容器
bun run stop:docker
```

### 监控和健康检查

```bash
# 健康检查
bun run health

# 监控面板
bun run monitor
```

监控服务会自动收集以下信息：
- 系统状态（运行时间、内存使用、CPU使用）
- 性能指标（操作时间、缓存命中率）
- 告警（内存使用过高、CPU使用过高）
- 日志轮换（自动管理日志文件大小）

## 最佳实践

### 错误处理

- 使用 `AppError` 类来抛出和处理错误
- 使用 `catchAsync` 装饰器来处理异步错误
- 记录错误日志

### 性能优化

- 使用缓存来减少重复计算
- 使用流式响应来提高用户体验
- 优化AI模型的使用，减少令牌消耗
- 使用性能分析器来监控和优化性能
- 使用内存管理器来优化内存使用

### 安全性

- 不要在代码中硬编码敏感信息
- 使用环境变量来存储配置
- 实现权限检查和安全审计
- 使用沙箱来限制代码执行的权限
- 记录安全事件和操作

### 可维护性

- 编写清晰的文档
- 使用类型定义来提高代码可读性
- 遵循代码风格指南
- 定期进行代码审查
- 编写单元测试和集成测试

### 监控和日志

- 使用监控服务来收集性能指标
- 定期检查系统健康状态
- 配置日志轮换，避免日志文件过大
- 设置告警阈值，及时发现问题
- 使用主题系统来改善用户体验

## 常见问题

### Q: 如何添加新的AI模型？

A: 在 `src/ai/clients` 目录下创建新的客户端实现，然后在 `src/ai/services/aiService.ts` 中注册。

### Q: 如何添加新的工具？

A: 在 `src/tools` 目录下创建新的工具实现，然后在 `src/tools/ToolFactory.ts` 和 `src/tools/ToolManager.ts` 中注册。

### Q: 如何添加新的命令？

A: 在 `src/commands/builtin` 目录下创建新的命令实现，命令会自动加载。

### Q: 如何添加新的技能？

A: 在 `src/skills` 目录下创建新的技能文件，技能会被技能加载器自动加载。技能需要实现 `Skill` 接口。

### Q: 如何切换主题？

A: 使用主题管理器来切换主题：
```typescript
import { getThemeManager } from './src/ui';
const themeManager = getThemeManager();
await themeManager.setTheme('dark');
```

### Q: 如何配置日志级别？

A: 在监控服务配置中设置日志级别，或者在环境变量中设置：
```typescript
const monitoringService = getMonitoringService({
  logLevel: 'info' // 'debug', 'info', 'warn', 'error'
});
```

### Q: 如何处理大文件？

A: 使用流式读取和写入，避免一次性加载整个文件到内存。

### Q: 如何启用监控服务？

A: 监控服务在应用初始化时会自动启动。你也可以手动启动：
```typescript
import { getMonitoringService } from './src/monitoring';
const monitoringService = getMonitoringService();
monitoringService.start();
```

### Q: 如何查看系统健康状态？

A: 运行健康检查脚本：
```bash
bun run health
```

### Q: 如何查看监控数据？

A: 运行监控脚本：
```bash
bun run monitor
```

### Q: 如何使用沙箱？

A: 创建沙箱并执行代码：
```typescript
import { getSandboxManager } from './src/security';
const sandboxManager = getSandboxManager();
const sandbox = await sandboxManager.createSandbox({
  name: 'safe-sandbox',
  allowedModules: ['fs', 'path'],
  memoryLimit: 1024 * 1024 * 100,
  cpuLimit: 0.5,
  timeout: 5000
});
const result = await sandboxManager.executeInSandbox(sandbox.id, 'return "Hello, World!"');
```

### Q: 如何配置权限？

A: 使用权限管理器来配置权限：
```typescript
import { getPermissionManager } from './src/security';
const permissionManager = getPermissionManager();
await permissionManager.grantPermission('user123', 'tool.file_read');
```

## 贡献

欢迎贡献代码！请按照以下步骤：

1. Fork 项目
2. 创建特性分支
3. 提交更改
4. 推送到分支
5. 创建 Pull Request

## 许可证

MIT
