# PY_APP

基于 TypeScript + Rust 架构的 AI Agent 项目，提供智能代码助手、工具执行、会话管理等功能。

## 技术栈

- **编排层**: TypeScript + Bun
- **性能核心**: Rust
- **终端 UI**: React + Ink
- **校验层**: Zod
- **协议层**: MCP + LSP
- **安全层**: 细粒度权限控制 + 安全审计

## 项目结构

```
PY_APP/
├── backend/
│   ├── src/           # 源代码
│   │   ├── analytics/     # 分析模块
│   │   ├── bridge/        # 桥接模块
│   │   ├── chat/          # 聊天模块
│   │   ├── chronos/       # 任务调度模块
│   │   ├── commands/      # 命令系统
│   │   ├── core/          # 核心模块
│   │   ├── cost/          # 成本跟踪模块
│   │   ├── entrypoints/   # 入口点
│   │   ├── governance/    # 治理模块
│   │   ├── hooks/         # 钩子系统
│   │   ├── llm/           # 语言模型客户端
│   │   ├── mcp/           # MCP协议实现
│   │   ├── memory/        # 记忆模块
│   │   ├── permission/    # 权限管理
│   │   ├── plugins/       # 插件系统
│   │   ├── sandbox/       # 沙箱环境
│   │   ├── security/      # 安全模块
│   │   ├── session/       # 会话管理
│   │   ├── skills/        # 技能系统
│   │   ├── streaming/     # 流处理
│   │   ├── tasks/         # 任务系统
│   │   ├── tools/         # 工具系统
│   │   ├── ui/            # 终端 UI
│   │   ├── utils/         # 工具函数
│   ├── configs/        # 配置文件
│   ├── data/           # 数据文件
│   ├── testing/        # 测试文件
│   ├── .env            # 环境变量
│   ├── package.json    # 项目配置
│   └── tsconfig.json   # TypeScript 配置
├── cc_code/           # 参考代码
└── dev_docs/          # 开发文档
```

## 核心功能

### 1. 工具系统
- **Bash 工具**: 执行命令行操作
- **LSP 工具**: 代码补全、诊断、定义跳转
- **REPL 工具**: 交互式代码执行
- **Notebook 工具**: 混合代码和文档
- **文件工具**: 读取、写入、编辑文件
- **任务工具**: 管理和执行任务

### 2. 插件系统
- **插件加载**: 从文件系统加载插件
- **插件管理**: 启用、禁用、卸载插件
- **插件 API**: 提供统一的插件接口

### 3. 命令系统
- **内置命令**: `vim`、`advisor`、`brief`、`commit` 等
- **命令执行**: 支持本地命令和远程命令
- **命令历史**: 记录和管理命令历史

### 4. 安全特性
- **细粒度权限控制**: 基于角色、用户和资源的权限管理
- **安全审计**: 记录和查询安全事件
- **输入验证**: 防止恶意输入和注入攻击
- **安全扫描**: 检测代码中的安全漏洞

### 5. 会话管理
- **本地会话**: 管理本地聊天会话
- **远程会话**: 支持远程连接和协作
- **WebSocket 通信**: 实时消息传递
- **SessionStorage**: 统一的会话存储管理

### 6. 工具执行优化
- **缓存机制**: 缓存工具执行结果
- **并行执行**: 支持多个工具并行执行
- **超时控制**: 防止工具执行超时
- **错误处理**: 统一的错误处理机制

## 开发

### 安装依赖
```bash
bun install
```

### 开发模式
```bash
bun run dev
```

### 构建
```bash
bun run build
```

### 测试
```bash
bun test
```

## 工具使用指南

### Bash 工具
```typescript
// 执行 bash 命令
const result = await toolManager.executeTool('bash', {
  command: 'ls -la',
  cwd: process.cwd()
});
```

### LSP 工具
```typescript
// 代码补全
const completions = await toolManager.executeTool('lsp', {
  action: 'complete',
  file: 'src/index.ts',
  position: { line: 10, character: 5 }
});
```

### REPL 工具
```typescript
// 执行 JavaScript 代码
const result = await toolManager.executeTool('repl', {
  code: 'console.log("Hello, world!")',
  language: 'javascript'
});
```

### Notebook 工具
```typescript
// 编辑 notebook
const result = await toolManager.executeTool('notebook', {
  action: 'edit',
  file: 'notebook.ipynb',
  cells: [
    { type: 'code', content: 'print("Hello, notebook!")' },
    { type: 'markdown', content: '# Hello Notebook' }
  ]
});
```

## 插件开发

### 创建插件
```typescript
// plugins/my-plugin/index.ts
import { Plugin, PluginContext } from '../src/plugins/types/Plugin';

export const plugin: Plugin = {
  id: 'my-plugin',
  name: 'My Plugin',
  version: '1.0.0',
  description: 'A sample plugin',
  
  async activate(context: PluginContext) {
    console.log('My plugin activated');
    // 注册命令、工具等
  },
  
  async deactivate() {
    console.log('My plugin deactivated');
  }
};

export default plugin;
```

### 加载插件
```typescript
import { createPluginManager, createPluginAPI } from './src/plugins';

const pluginAPI = createPluginAPI();
const pluginManager = createPluginManager('./plugins', pluginAPI);

await pluginManager.loadPlugins();
const activePlugins = pluginManager.getActivePlugins();
console.log(`Active plugins: ${Array.from(activePlugins)}`);
```

## 安全配置

### 权限规则
在 `backend/configs/permissions.yaml` 中配置权限规则：

```yaml
rules:
  - id: "allow-read"
    action: "allow"
    resource: "file:read"
    condition: "true"
  
  - id: "deny-write"
    action: "deny"
    resource: "file:write"
    condition: "user.role !== 'admin'"
```

### 安全审计
```typescript
import { getSecurityAuditManager } from './src/security/managers/SecurityAuditManager';

const auditManager = getSecurityAuditManager();

await auditManager.logAuditEvent({
  type: 'permission_check',
  severity: 'info',
  description: 'User accessed file',
  details: { userId: '123', resource: 'file.txt' }
});
```

## 部署指南

### 环境变量
在 `.env` 文件中配置环境变量：

```
# 服务器配置
PORT=3000
HOST=0.0.0.0

# 数据库配置
DATABASE_URL=sqlite://./data/py_copilot.db

# 安全配置
JWT_SECRET=your-secret-key

# 语言模型配置
OPENAI_API_KEY=your-api-key
```

### 生产构建
```bash
bun run build

# 启动服务器
bun start
```

## 贡献指南

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 打开 Pull Request

## 许可证

MIT

