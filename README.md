# PY_APP

基于 TypeScript + Rust 架构的 AI Agent 项目

## 项目简介

PY_APP 是一个功能强大的 AI Agent 项目，提供了以下核心功能：

- **命令行交互**：支持多种命令，如 `hello`、`status`、`read`、`list`、`search`、`exec`、`write`、`edit`、`glob` 等
- **工具链扩展**：实现了 FileWriteTool、FileEditTool、GlobTool、GrepTool 等常用工具
- **AI模型API集成**：支持 OpenAI 和 Anthropic Claude 等多种 AI 模型
- **聊天功能**：支持聊天会话管理、历史记录、消息发送和流式响应
- **AI代理功能**：支持工具使用、策略执行和内存管理
- **任务管理系统**：支持任务的创建、执行、监控和管理
- **性能和可靠性优化**：包括缓存机制、错误处理、监控和日志

## 技术栈

- **前端**：TypeScript, React, Ink (命令行UI)
- **后端**：TypeScript, Bun
- **存储**：文件系统, SQLite
- **AI模型**：OpenAI, Anthropic Claude

## 快速开始

### 环境要求

- Node.js >= 18.0.0
- Bun >= 1.0.0

### 安装

```bash
# 克隆项目
git clone https://github.com/cocosoft/PY_APP.git

# 进入项目目录
cd PY_APP/backend

# 安装依赖
bun install
```

### 配置

创建 `.env` 文件，添加以下配置：

```env
# OpenAI API 密钥
OPENAI_API_KEY=your_openai_api_key

# Anthropic API 密钥
ANTHROPIC_API_KEY=your_anthropic_api_key

# 环境变量
NODE_ENV=development
```

### 运行

```bash
# 开发模式
bun run dev

# 生产模式
bun run start

# 构建
bun run build
```

## 命令行使用

### 基本命令

```bash
# 显示帮助信息
PY_APP help

# 显示状态信息
PY_APP status

# 读取文件
PY_APP read <file_path>

# 列出文件
PY_APP list <directory>

# 搜索文件
PY_APP search <pattern> <directory>

# 执行命令
PY_APP exec <command>

# 写入文件
PY_APP write <file_path> <content> [--force]

# 编辑文件
PY_APP edit <file_path> <old_string> <new_string>

# 匹配文件
PY_APP glob <pattern>
```

### 聊天命令

```bash
# 启动聊天会话
PY_APP chat

# 列出聊天会话
PY_APP chat list

# 切换聊天会话
PY_APP chat switch <session_id>

# 删除聊天会话
PY_APP chat delete <session_id>
```

### 代理命令

```bash
# 创建代理
PY_APP agent create <name> <description>

# 列出代理
PY_APP agent list

# 执行代理任务
PY_APP agent execute <agent_id> <task_description>

# 删除代理
PY_APP agent delete <agent_id>
```

### 任务命令

```bash
# 创建任务
PY_APP task create <name> <description> <type>

# 列出任务
PY_APP task list [--status <status>] [--priority <priority>] [--type <type>]

# 开始任务
PY_APP task start <task_id>

# 完成任务
PY_APP task complete <task_id> [--output <output>]

# 失败任务
PY_APP task fail <task_id> <error>

# 取消任务
PY_APP task cancel <task_id>
```

## API 文档

### 模块导出

#### AI 模块

```typescript
import { aiService, AIService, AIModelType, AIMessage, AIResponse } from './src/ai';

// 使用示例
const response = await aiService.generate([
  { role: 'user', content: 'Hello, how are you?' }
]);
console.log(response.content);
```

#### 聊天模块

```typescript
import { chatService, ChatSession, ChatMessage } from './src/chat';

// 使用示例
const session = chatService.createSession({
  name: 'My Chat',
  model: 'gpt-3.5-turbo'
});

const response = await session.sendMessage('Hello, how are you?');
console.log(response.message.content);
```

#### 代理模块

```typescript
import { agentService, AIAgent, AgentTask } from './src/agent';

// 使用示例
const agent = agentService.createAgent({
  name: 'My Agent',
  defaultStrategy: 'tool_use'
});

const task: AgentTask = {
  id: 'task-1',
  name: 'Read File',
  description: 'Read the content of package.json',
  input: { path: 'package.json' }
};

const response = await agent.execute(task);
console.log(response.content);
```

#### 任务模块

```typescript
import { taskService, TaskType, TaskPriority } from './src/task';

// 使用示例
const task = await taskService.createTask({
  name: 'Generate Report',
  description: 'Generate a sales report',
  type: TaskType.AI_GENERATION,
  priority: TaskPriority.HIGH,
  input: { data: 'sales_data.json' }
});

await taskService.startTask(task.id);
// 执行任务...
await taskService.completeTask(task.id, { report: 'report.pdf' });
```

## 项目结构

```
PY_APP/
├── backend/
│   ├── src/
│   │   ├── agent/          # AI代理模块
│   │   ├── ai/             # AI模型API集成
│   │   ├── chat/           # 聊天功能
│   │   ├── cli/            # 命令行接口
│   │   ├── config/         # 配置管理
│   │   ├── task/           # 任务管理系统
│   │   ├── tools/          # 工具链
│   │   ├── utils/          # 工具函数
│   │   └── index.ts        # 主入口
│   ├── package.json        # 项目配置
│   └── tsconfig.json       # TypeScript配置
├── dev_docs/               # 开发文档
└── README.md               # 项目文档
```

## 开发指南

### 代码风格

- 使用 TypeScript 进行开发
- 遵循 ESLint 和 Prettier 规则
- 使用函数级注释
- 保持代码可读性

### 测试

```bash
# 运行测试
bun run test

# 类型检查
bun run typecheck

# 代码检查
bun run lint

# 代码格式化
bun run format
```

### 部署

1. 构建项目：`bun run build`
2. 部署 `dist` 目录到服务器
3. 设置环境变量
4. 启动服务：`bun run start`

## 贡献

欢迎贡献代码！请按照以下步骤：

1. Fork 项目
2. 创建特性分支
3. 提交更改
4. 推送到分支
5. 创建 Pull Request

## 许可证

MIT
