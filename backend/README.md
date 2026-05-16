# PY_APP — Backend

AI Agent 后端服务，基于 TypeScript + Bun + Rust 架构，提供交互式命令行智能助手。

## 技术栈

| 层级 | 技术 |
|------|------|
| **运行时** | Bun（主要）/ Node.js |
| **语言** | TypeScript (95%) + Rust (5%) |
| **终端 UI** | React + Ink |
| **AI 接口** | DeepSeek API（默认，可通过适配层切换） |
| **协议层** | MCP（Model Context Protocol）+ LSP |
| **安全** | AST 级命令分析、细粒度权限控制、安全审计 |
| **原生模块** | Rust（Bash AST 解析、安全分析、压缩） |

## 快速开始

```bash
# 安装依赖
bun install

# 配置 API 密钥
cp .env.example .env
# 编辑 .env，填入 DEEPSEEK_API_KEY

# 开发模式启动（带热重载）
bun run dev

# 生产模式
bun run start
```

## 项目结构

```
src/
├── main.ts                 # 应用启动入口（launch 函数）
├── entrypoints/            # 运行模式入口
│   ├── cli.tsx             # CLI 模式
│   ├── init.ts             # 环境初始化
│   ├── repl.ts             # REPL 模式
│   └── mcp.ts              # MCP Server 模式
├── agent/                  # AI Agent 核心（ACP/BTW/MOA 多智能体架构）
├── ai/                     # AI 模型适配层（模型目录、成本、策略）
├── analytics/              # 分析统计
├── bootstrap/              # 启动引导
├── bridge/                 # 远程桥接控制
├── buddy/                  # AI 伙伴系统
├── cache/                  # 缓存模块
├── channels/               # 消息渠道
├── chat/                   # 会话聊天
├── chronos/                # 定时任务调度
├── cli/                    # CLI 命令系统
├── commands/               # 命令注册
├── config/                 # 配置管理
├── constants/              # 常量定义
├── context/                # 上下文引擎
├── converter/              # 格式转换
├── core/                   # 核心基础设施（ACP/API/Auth/I18n/Task）
├── cost/                   # API 调用成本追踪
├── daemon/                 # 守护进程
├── docs/                   # 内置文档系统
├── error/                  # 错误处理
├── flows/                  # 流程引擎
├── governance/             # 治理模块
├── hooks/                  # 钩子系统
├── ink/                    # 终端 UI（Ink 实现）
├── lsp/                    # LSP 客户端
├── mcp/                    # MCP 协议实现
├── media/                  # 媒体处理
├── memory/                 # 记忆模块
├── models/                 # 模型类型定义
├── modules/                # 模块系统
├── oauth/                  # OAuth 认证
├── plugin-sdk/             # 插件 SDK
├── plugins/                # 插件管理
├── query/                  # 查询引擎
├── sandbox/                # 沙箱环境
├── security/               # 安全模块
├── services/               # 业务服务
├── session/                # 会话管理
├── skills/                 # 技能系统
├── streaming/              # 流式处理
├── task/                   # 任务引擎
├── tasks/                  # 任务实现
├── tools/                  # 工具系统（Bash/文件/LSP/Web 等）
├── types/                  # 全局类型定义
├── ui/                     # UI 组件
├── utils/                  # 工具函数
├── vim/                    # Vim 模式
├── wizard/                 # 配置向导
├── healthcheck.ts          # 健康检查
├── index.ts                # 历史入口（已弃用）
├── main.ts                 # 主入口
└── monitor.ts              # 系统监控
```

## 运行模式

| 模式 | 启动方式 | 说明 |
|------|----------|------|
| **REPL** | `bun run dev` / `bun run start` | 交互式命令行，默认模式 |
| **CLI** | 通过 `launch()` 参数指定 | 一次性命令执行 |
| **MCP Server** | `bun run src/entrypoints/mcp.ts` | MCP 协议服务器 |
| **Daemon** | 通过 `launch()` 参数指定 | 后台守护进程 |

## 命令系统

应用使用 `/` 开头的斜杠命令体系，在 REPL 模式下直接输入交互。

### 核心命令分类

| 类别 | 命令 | 说明 |
|------|------|------|
| **系统** | `/help` `/clear` `/exit` `/version` | 基本操作 |
| **工具** | `/bash` `/fetch` `/websearch` `/grep` `/edit` | 工具调用 |
| **管理** | `/task` `/todo` `/session` `/config` | 数据管理 |
| **Agent** | `/subagent-run` `/subagent` `/agent-instance` | 智能代理 |
| **技能** | `/skill list` `/skill enable` `/skill disable` | 技能管理 |
| **监控** | `/cost` `/tokens` `/env` `/debug` | 系统监控 |
| **远程** | `/bridge` | 远程桥接控制 |
| **MCP** | `/mcp` | MCP 服务器管理 |
| **IDE** | `/ide` | IDE 集成 |
| **LSP** | `/lsp` | 语言服务器协议 |

## 原生模块

`native/` 目录包含 Rust 编写的性能关键模块：

```bash
# 构建 Rust 原生模块
bun run native:build

# 调试构建
bun run native:build:debug

# 运行原生测试
bun run native:test
```

原生模块提供：
- **Bash AST 解析** — 命令结构分析
- **安全分析** — 命令安全检测
- **上下文管理** — 系统上下文收集
- **压缩** — 数据压缩

> 原生模块不可用时自动降级为 TypeScript 实现。

## 构建变体

```bash
bun run build:core        # 核心版
bun run build:personal    # 个人版
bun run build:coding      # 编程版
bun run build:enterprise  # 企业版
bun run build:dry-run     # 构建预览（不实际构建）
```

## 开发命令

```bash
bun run dev               # 开发模式（热重载）
bun run typecheck         # 类型检查
bun run lint              # 代码检查
bun run lint:fix          # 自动修复
bun run format            # 格式化代码
bun test                  # 运行测试
bun run test:coverage     # 测试覆盖率
bun run health            # 健康检查
bun run monitor           # 系统监控
```

## 文档

完整文档位于 `docs/` 目录，建议新用户从 [📖 用户引导](docs/用户引导/guide.md) 开始。

## 许可证

MIT
