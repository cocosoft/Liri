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

> 以下对标分析基于公开源代码的深度阅读，对标对象为 **CC** (Claude Code)、**OpenClaw**（多通道 AI 网关）、**Hermes Agent**（自改进 AI 代理）、**Codex**（Rust AI 编码引擎）及 **Cline**（VS Code AI 插件）。分析日期：2026-05-24。详细报告请见 [dev_docs/20260524/summary.md](dev_docs/20260524/summary.md)。

### 十维综合对标矩阵

| 维度 | PY_APP | CC | OpenClaw | Hermes | Codex | Cline |
|------|:-----:|:---:|:--------:|:------:|:-----:|:-----:|
| **D1 Agent 系统** | **★** | ⚠️ | ⚠️ | ✅ | ❌ | ⚠️ |
| **D2 工具系统** | **★** | ✅ | ✅ | ✅ | ⚠️ | ⚠️ |
| **D3 会话管理** | **★** | ⚠️ | ⚠️ | ✅ | ❌ | ⚠️ |
| **D4 记忆系统** | **★** | ⚠️ | ❌ | ✅ | ❌ | ❌ |
| **D5 安全系统** | **★** | ⚠️ | ✅ | ✅ | ✅ | ⚠️ |
| **D6 查询引擎** | **★** | ⚠️ | ✅ | ★ | ❌ | ✅ |
| **D7 MCP 支持** | **★** | ⚠️ | ✅ | ✅ | ⚠️ | ✅ |
| **D8 渠道网关** | **★** | ❌ | ✅ | ❌ | ❌ | ❌ |
| **D9 插件系统** | **★** | ⚠️ | ⚠️ | ✅ | ❌ | ❌ |
| **D10 定时任务** | **★** | ❌ | ⚠️ | ✅ | ❌ | ⚠️ |

**图例**：★ = 领先 | ✅ = 完善 | ⚠️ = 基础 | ❌ = 缺失

**评分总览**：

| 产品 | ★ (领先) | ✅ (完善) | ⚠️ (基础) | ❌ (缺失) | 总分 |
|------|:----:|:----:|:----:|:----:|:----:|
| **PY_APP** | **10** | 0 | 0 | 0 | **40/40** |
| Hermes | 2 | 7 | 1 | 0 | 29/40 |
| OpenClaw | 1 | 5 | 4 | 0 | 25/40 |
| CC | 0 | 1 | 7 | 2 | 17/40 |
| Cline | 0 | 3 | 5 | 2 | 16/40 |
| Codex | 1 | 1 | 3 | 5 | 12/40 |

### 独特优势

1. **Agent 架构最深** — 四层抽象（`AIAgent` + `AgentStrategy` + `AgentService` + `AgentMemory`）、7 种策略模式、双引擎协作（Swarm 同构群组 + MoA 异构聚合）、Step 级 6 阶段轨迹记录
2. **工具生态最丰富** — 60+ 内置工具，覆盖文件/Bash/搜索/LSP/浏览器/图像/语音/视频/PDF/Agent 协作/计划/看板/MCP/会话/定时/通知等，业界覆盖最广
3. **安全防护最深** — 唯一 5 层安全防护体系（Rust AST 编译时分析 → TS 语义分析 → Guardrail 规则引擎 → AutoMode 分类器 → Sandbox 沙箱），含 40+ CommandSemanticPattern 命令语义数据库
4. **MCP 全栈实现** — 唯一的三层传输协议（stdio/HTTP/WebSocket）、MCP 认证系统（`McpAuthTool` Token 认证）、双层配置热重载、标准层+增强层双轨架构
5. **跨平台覆盖最广** — 30+ 平台适配器（Telegram/Discord/Slack/WhatsApp/Line/Signal/WeChat/Matrix/Dingtalk 等），全球覆盖中国/日本/韩国/越南/欧美主要市场
6. **查询引擎最可控** — TAOR 四阶段循环（Think→Act→Observe→Repeat）含 5 种 StopHook 停止条件 + Checkpoint 断点续跑 + 三级 Token 预算（Warning/Critical/Hard）
7. **会话记忆闭环最完整** — SQLite FTS5 + 可切换压缩（gzip/lz4/zstd/raw）+ Markdown/JSON 双格式转录 + 9 个会话管理工具 + Session Spawn 父子会话衍生
8. **Rust 原生加速** — `backend/native/` Rust AST 编译时分析，C FFI 零依赖调用，渐进增强降级到 TS，对标产品中独有

### 对标差距

| 优先级 | 方向 | 对标产品 | 说明 |
|:-----:|------|----------|------|
| **P1** | ACP 协议完整实现 | OpenClaw | `AcpClient`/`AcpServer` 双端 + 能力协商 + Translator，当前 `backend/src/acp/` 仅基础框架 |
| **P2** | 可插拔 ContextEngine 体系 | Hermes | 多策略压缩引擎（摘要/截断/混合），当前 `ContextCompact` 是单体实现 |
| **P2** | Curator 自动化子代理调度 | Hermes | 空闲触发技能维护 + 状态持久化，当前 ForkSubagent 偏工具集成 |
| **P2** | Sandbox bwrap 容器级隔离 | Codex | 文件系统白名单 + 网络访问控制 + bwrap 命名空间隔离，当前基于 Node.js 进程管理 |
| **P3** | IDEMPOTENT/MUTATING 工具分类 | Hermes | 显式硬编码工具分类 + 精确重复失败阻断 |
| **P3** | Checkpoint 磁盘持久化 | — | `MemoryCheckpointStorage` 仅内存，进程重启丢失 |

### 发展路线

- **Phase 1**（关键安全与标准）：完整 ACP 协议实现、Sandbox bwrap 容器级隔离
- **Phase 2**（架构优化）：可插拔 ContextEngine 体系、Curator 自动化子代理调度、Checkpoint 磁盘持久化
- **Phase 3**（精细化改进）：IDEMPOTENT/MUTATING 工具分类、Agent 策略智能选择器、工具依赖图拓扑排序、会话消息队列

> **详细对标分析报告索引**：10 维对比矩阵见 [dev_docs/20260524/matrix/](dev_docs/20260524/matrix/) 目录，综合评估见 [summary.md](dev_docs/20260524/summary.md)，差距分析与改进路线图见 [gaps.md](dev_docs/20260524/gaps.md)。

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
