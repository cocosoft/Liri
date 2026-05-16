# PY_APP

基于 TypeScript + Rust 架构的 AI Agent 项目，提供智能命令行助手和丰富的工具生态。

## 项目简介

PY_APP 是一个运行在终端中的 **AI 智能助手**，支持自然语言交互和多种运行模式。它能够理解您的需求，自动调用合适的工具来完成任务。

### 核心能力

- **🤖 AI 对话** — 基于 DeepSeek API 的智能问答，支持代码解释、技术答疑等
- **📁 文件操作** — 读取、写入、搜索、编辑文件（支持正则搜索）
- **⚡ 命令执行** — 在安全沙箱中执行 Shell 命令，带多层安全检查
- **🌐 网络功能** — 网页抓取（HTML 转 Markdown）、搜索引擎查询
- **📋 任务管理** — 待办事项和任务的全生命周期管理
- **🔧 开发辅助** — LSP 代码智能提示、Notebook 编辑、代码执行
- **🔄 后台任务** — 子代理异步执行长时间任务
- **🧩 插件系统** — 可扩展的插件和技能体系
- **🔌 多模式运行** — REPL 交互模式 / CLI 模式 / MCP Server 模式 / 守护进程模式

## 快速开始

### 环境要求

- [Bun](https://bun.sh) >= 1.0（推荐）或 Node.js >= 20
- Windows 10+ / macOS 12+ / Linux

### 安装与运行

```bash
# 1. 进入 backend 目录
cd backend

# 2. 安装依赖
bun install

# 3. 配置 API 密钥
cp .env.example .env
# 编辑 .env 文件，填入 DEEPSEEK_API_KEY

# 4. 启动应用
bun run dev
```

启动后进入交互式 REPL 模式，您可以直接输入问题或使用 `/` 命令。

### 快速体验

```
# 直接提问（自然语言）
你好，请解释依赖注入是什么？

# 使用命令
/help         查看所有可用命令
/clear        清屏
/exit         退出应用
```

详细的使用指南请查看 [📖 用户引导](backend/docs/用户引导/guide.md)。

## 项目结构

```
PY_APP/
├── backend/              # 主应用（TypeScript + Bun）
│   ├── src/              # 源代码
│   │   ├── main.ts           # 应用入口（launch 函数）
│   │   ├── entrypoints/      # 运行模式入口（CLI / REPL / MCP）
│   │   ├── cli/              # CLI 命令系统
│   │   ├── tools/            # 工具系统（Bash / 文件 / LSP 等）
│   │   ├── skills/           # 技能系统
│   │   ├── agent/            # AI Agent 核心
│   │   ├── ai/               # AI 模型适配层
│   │   ├── session/          # 会话管理
│   │   ├── tasks/            # 任务系统
│   │   ├── plugins/          # 插件系统
│   │   ├── mcp/              # MCP 协议实现
│   │   ├── bridge/           # 远程桥接
│   │   ├── chronos/          # 任务调度
│   │   ├── core/             # 核心基础设施
│   │   └── ...               # 更多模块
│   ├── native/           # Rust 原生模块（性能核心）
│   ├── config/           # 治理配置文件
│   ├── configs/          # 应用配置
│   ├── data/             # 数据存储
│   ├── docs/             # 完整文档目录
│   ├── .env.example      # 环境变量模板
│   └── package.json      # 项目配置
├── py-app-client/        # 桌面客户端（React + Tauri）
│   └── src/              # React 前端源码
└── README.md
```

## 技术栈

| 层级 | 技术 |
|------|------|
| **运行时** | Bun（主要）/ Node.js |
| **语言** | TypeScript (95%) + Rust (5%) |
| **终端 UI** | React + Ink |
| **AI 接口** | DeepSeek API（可通过适配层切换模型） |
| **协议层** | MCP（Model Context Protocol）+ LSP |
| **桌面端** | Tauri v2 + React + Vite |
| **安全** | AST 级命令分析、细粒度权限控制、安全审计 |
| **构建** | 内置构建脚本，支持多构建变体（core / personal / coding / enterprise） |

## 项目对标

> 以下对标分析基于公开源代码进行，对标对象为 **Claude Code**（Anthropic 出品的 AI 编程助手）、**OpenClaw**（多通道 AI 网关）和 **Hermes Agent**（自改进 AI 代理）。分析日期：2026-05-16。详细报告请见 [dev_docs/20260516/对标分析报告.md](dev_docs/20260516/对标分析报告.md)。

### 模块成熟度矩阵

| 模块 | PY_APP | Claude Code | OpenClaw | Hermes Agent |
|------|:------:|:-----------:|:--------:|:------------:|
| **Agent 系统** | ⚠️ 基础 | ✅ 完善 | ✅ 完善 | ✅ 完善 |
| **工具系统** | ✅ 完整 | ✅ 完善 | ✅ 完善 | ✅ 完善 |
| **技能系统** | ✅ 完整 | ✅ 完善 | ✅ 完善 | ✅ 完善 |
| **MCP 实现** | ✅ 完整 | ✅ 完善 | ✅ 完善 | ⚠️ 基础 |
| **CLI 系统** | ✅ 完整 | ✅ 完善 | ✅ 完善 | ✅ 完善 |
| **安全模型** | ✅ 完整 | ✅ 完善 | ✅ 完善 | ⚠️ 基础 |
| **会话管理** | ✅ 完整 | ✅ 完善 | ⚠️ 基础 | ⚠️ 基础 |
| **记忆系统** | ✅ 完整 | ✅ 完善 | ⚠️ 基础 | ✅ 完善 |
| **查询引擎** | ✅ 完整 | ✅ 完善 | ❌ 无独立模块 | ❌ 嵌入 |
| **插件系统** | ✅ 完整 | ✅ 完善 | ✅ 完善 | ✅ 完善 |
| **配置管理** | ✅ 完整 | ✅ 完善 | ✅ 完善 | ⚠️ 基础 |
| **渠道/网关** | ❌ 无 | ❌ 无 | ✅ 完善（16+渠道） | ✅ 完善（18+平台） |
| **Cron 调度** | ⚠️ 初期 | ⚠️ 基础 | ✅ 完善 | ✅ 完善 |
| **流式处理** | ⚠️ 基础 | ✅ 完善 | ✅ 完善 | ⚠️ 基础 |
| **治理模块** | ✅ 独有 | ❌ 无 | ❌ 无 | ❌ 无 |
| **Rust原生绑定** | ✅ 独有 | ❌ 无 | ❌ 无 | ❌ 无 |
| **多语言** | ❌ 仅中文 | ✅ 英文 | ✅ 英文 | ✅ 6语言 |
| **桌面客户端** | ✅ Tauri | ❌ CLI-only | ❌ CLI-only | ❌ CLI-only |

### 独特优势

1. **治理分析模块** — `IntelligentGovernanceAnalyzer` 提供多维度智能治理分析（风险、合规、性能、成熟度、效率），在对标项目中独一无二
2. **Rust 原生模块** — 提供高性能计算能力，适合未来扩展计算密集型任务
3. **安全模块体系** — `CompleteSecuritySystem` 统一安全入口，AST 级命令语义分析，组策略支持，体系化程度最高
4. **会话管理** — 包含 FTS5 全文搜索、会话锁、迁移、清理、WebSocket 等完整能力
5. **查询引擎模块化** — 完整的查询流程（输入处理 → 重试 → 上下文折叠 → Token 预算 → TAOR 循环）
6. **桌面客户端** — 基于 Tauri v2 + React，其他对标项目均为纯 CLI 工具

### 已知不足

1. **渠道/网关缺失** — 没有实现消息渠道（Slack/Telegram/Discord 等），对比 OpenClaw 16+ 渠道、Hermes 18+ 平台差距显著
2. **AI 模型支持有限** — 供应商适配层不完整，缺少模型自动发现和路由能力
3. **Agent 编排深度不足** — 缺少子代理、协作者等高级模式
4. **缺少提示词目录** — 所有提示词嵌入代码中，不可扩展
5. **国际化缺失** — 文档和输出全部为中文，限制海外用户采用
6. **测试覆盖不足** — 测试分布不均匀，缺少集成测试和 E2E 测试
7. **导入路径混乱** — 同时使用 `@modules/` 别名和相对路径，部分别名无实际映射

### 发展路线

- **短期**：统一导入路径、补全测试、英文 README、修复类型错误
- **中期**：实现基础网关、增强模型支持、Agent 高级模式、提示词目录
- **长期**：深耕治理/Rust 差异化优势、完善多平台支持、国际化社区建设

## 运行模式

PY_APP 支持多种启动模式，通过 `launch()` 函数统一分发：

| 模式 | 命令 | 说明 |
|------|------|------|
| **REPL** | `bun run dev` / `bun run start` | 交互式命令行，默认模式 |
| **CLI** | —（由启动参数决定） | 一次性命令执行 |
| **MCP Server** | —（`--mode mcp`） | MCP 协议服务器 |
| **Daemon** | —（`--mode daemon`） | 后台守护进程 |

## 命令系统

PY_APP 使用 `/` 开头的斜杠命令，在 REPL 模式下输入 `/help` 可查看全部命令。

### 常用命令

| 命令 | 功能 |
|------|------|
| `/help` | 查看帮助 |
| `/clear` | 清屏 |
| `/exit` | 退出 |
| `/bash <cmd>` | 执行 Shell 命令 |
| `/fetch <url>` | 获取网页内容 |
| `/websearch <q>` | 网络搜索 |
| `/grep <pattern>` | 文件内容搜索 |
| `/edit <file> <old> <new>` | 编辑文件 |
| `/task <action>` | 任务管理 |
| `/todo <action>` | 待办管理 |
| `/session <action>` | 会话管理 |
| `/subagent-run <action>` | 子代理任务 |
| `/skill <action>` | 技能管理 |
| `/config <action>` | 配置管理 |
| `/cost` | 查看 API 成本 |
| `/tokens` | 查看 Token 统计 |
| `/debug <action>` | 调试工具 |

## 文档索引

完整的文档位于 `backend/docs/` 目录：

| 文档 | 说明 |
|------|------|
| [📖 用户引导](backend/docs/用户引导/guide.md) | 新手上路指南 |
| [🚀 快速入门](backend/docs/快速入门/index.md) | 安装部署与环境配置 |
| [📚 完整命令参考](backend/docs/USAGE.md) | 所有命令的详细参数说明 |
| [🔧 工具参考](backend/docs/工具参考/index.md) | 每个工具的详细用法 |
| [🧩 插件系统](backend/docs/插件系统/index.md) | 插件开发与使用 |
| [💻 开发指南](backend/docs/开发指南/index.md) | 二次开发指引 |
| [❓ FAQ](backend/docs/帮助与支持/faq.md) | 常见问题 |

## 桌面客户端

`py-app-client/` 目录包含基于 **Tauri v2 + React** 的桌面客户端，提供图形界面：

```bash
cd py-app-client
npm install
npm run tauri dev
```

## 构建变体

PY_APP 支持多种构建变体，适应不同使用场景：

```bash
# 核心版（最小功能集）
bun run build:core

# 个人版
bun run build:personal

# 编程版（面向开发者）
bun run build:coding

# 企业版（全功能）
bun run build:enterprise
```

## 许可证

MIT
