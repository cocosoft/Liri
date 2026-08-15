<div align="center">

<img src="app/assets/logo.png" alt="Liri Logo" width="120" />

# Liri · OpenLiri

> 玲珑鸟 · 你的 AI 私人助手
> 官网：https://openliri.com

**终端里的 AI 智能体 · 连接 26+ 平台的智能助手**

一键安装 · 自然语言交互 · 100+ 内置工具 · 企业级安全

[![CI Status](https://github.com/cocosoft/Liri/actions/workflows/ci.yml/badge.svg)](https://github.com/cocosoft/Liri/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![Version](https://img.shields.io/badge/version-0.4.38-blue)

[快速开始](#-快速开始) •
[功能概览](#-功能概览) •
[运行模式](#-运行模式) •
[渠道生态](#-渠道生态) •
[文档](#-文档)

</div>

---

## 🎯 这是什么

Liri 是一个运行在终端中的 **AI 智能助手**。你用它做什么？

- **终端里的编程搭档** — 在命令行中自然语言对话，读代码、搜文件、写脚本、查文档
- **跨平台消息机器人** — 接入 Telegram、Discord、微信、钉钉、Slack 等 26 个平台，一处部署处处可用
- **可编程 AI 工作流** — 插件系统 + 技能系统 + 定时任务，构建属于你的自动化流程
- **安全的命令执行环境** — Rust AST 级安全分析 + 沙箱隔离，让 AI 安全地操作你的系统

> ⚡ **一行命令启动**：`cd app && bun install && cp .env.example .env` 填入 API Key，即可开始对话

拥有 60+ 模块化子系统、4 阶段分层启动、三级延迟加载策略、多智能体通信协议（ACP），以及完整的安全沙箱与可观测性体系。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| **运行时** | Bun（主要）/ Node.js |
| **语言** | TypeScript (95%) + Rust (5%) |
| **终端 UI** | React + Ink |
| **AI 接口** | DeepSeek API（默认），支持多 Provider 切换（OpenAI、Gemini 等） |
| **协议层** | ACP（Agent Communication Protocol）+ MCP + LSP |
| **安全** | AST 级命令分析、细粒度权限控制、安全审计、Docker 沙箱 |
| **可观测性** | OpenTelemetry（Tracing + Metrics）、结构化日志、告警体系 |
| **存储** | SQLite + FTS5 全文搜索、文件系统持久化、缓存层 |
| **原生模块** | Rust（Bash AST 解析、安全分析、压缩） |

---

## 🚀 快速开始

### 环境要求

- [Bun](https://bun.sh) >= 1.0（推荐）或 Node.js >= 20
- Windows 10+ / macOS 12+ / Linux

### 安装（30 秒）

```bash
# 1. 进入应用目录
cd app

# 2. 安装依赖
bun install

# 3. 配置 API 密钥（DeepSeek 新用户送 500 万 tokens）
cp .env.example .env
# 编辑 .env，填入 DEEPSEEK_API_KEY

# 4. 启动
bun run dev
```

启动后直接输入问题即可：

```
你好，请解释 TypeScript 的装饰器模式
```

```
请帮我搜索一下 Rust 异步编程的最佳实践
```

```
读取当前目录下的 package.json，告诉我依赖列表
```

首次启动将自动进入 **Onboard 引导**，引导你配置 API 密钥和基础设置。

### 配置自己的 AI 模型

支持 DeepSeek、OpenAI、Ollama（本地）、Azure、Vertex 等多种模型，修改 `.env` 即可切换。

---

## 启动架构

应用采用 **四阶段（T0-T3）分层启动**，确保核心功能快速就绪，重型模块延迟加载：

```
T0 ── 并行预读取（MDM / Keychain，不阻塞）
 │
T1 ── 模块系统初始化（仅 CRITICAL 模块）
 │
T2 ── 模式分发（REPL / CLI / MCP / Daemon）
 │
T3 ── 后台延迟加载（DEFERRED + ON_DEMAND 模块）
```

模块按优先级分三级：
- **CRITICAL** — 启动时必需加载（core、ai、config、error、performance 等）
- **DEFERRED** — 启动完成后按批次加载（chat、session、tools 等）
- **ON_DEMAND** — 首次按需动态 import（security、sandbox、mcp、voice 等）

---

## ✨ 功能概览

### 🤖 AI 对话引擎

| 能力 | 说明 |
|------|------|
| 多模型支持 | DeepSeek / OpenAI / Ollama / Azure / Vertex |
| 多轮对话 | 完整会话管理，支持上下文记忆 |
| 思维链 | Agent 自主规划-执行-观察循环（TAOR），5 种停止条件 |
| 流式输出 | 实时显示 AI 思考过程 |
| Token 预算 | 三级预算控制（Warning / Critical / Hard），防止超额 |

### 🛠 100+ 内置工具

| 分类 | 工具 |
|------|------|
| 📁 文件操作 | 读写文件、搜索替换、glob 匹配、代码分析 |
| ⚡ 命令执行 | Bash 沙箱执行、安全分析、权限控制 |
| 🌐 网络能力 | 网页抓取（HTML→Markdown）、搜索引擎查询 |
| 🖼 媒体处理 | 图片生成/处理、语音合成/识别、视频生成、PDF 解析 |
| 💻 编程辅助 | LSP 智能提示、代码执行、Notebook 编辑 |
| 🧩 Agent 协作 | 子代理（SubAgent）异步执行、技能编排 |
| 📋 任务管理 | 待办事项、任务全生命周期管理、定时任务调度 |
| 🔌 MCP 工具 | Model Context Protocol 客户端/服务器、认证管理 |
| 💬 会话工具 | 会话管理、日志转录、父子会话衍生 |
| 🔧 系统工具 | 时间/日期、监控指标、系统诊断 |

### 🔒 五层安全防护

```
Rust AST 编译时分析 → TypeScript 语义分析 → Guardrail 规则引擎 → AutoMode 分类器 → Sandbox 沙箱隔离
```

- 40+ 命令语义模式数据库，识别危险操作
- 细粒度权限控制，支持按工具/按通道授权
- 完整审计日志，所有操作可追溯
- 速率限制与会话风险行为追踪

### 🧩 插件系统

- 标准插件 SDK（`@liri/core` / `@liri/personal` / `@liri/coding` / 企业版）
- 插件市场支持，本地和 npm 来源
- 完整的生命周期管理（激活、停用、热加载）
- 技能系统，支持条件触发和自动编排

---

## 🔌 运行模式

| 模式 | 命令 | 适用场景 |
|------|------|---------|
| **REPL** 🖥 | `bun run dev` | 终端交互，日常使用 |
| **CLI** ⌨️ | 启动参数指定 | 一次性命令、管道处理 |
| **MCP Server** 🔗 | `--mode mcp` | 作为 MCP 服务器供其他应用调用 |
| **Daemon** ⚙️ | `--mode daemon` | 后台守护进程，配合消息通道使用 |

---

## 🌐 渠道生态

一次部署，连接所有平台。Liri 支持 **26+ 消息通道**，配置环境变量即可启用：

| 区域 | 通道 |
|------|------|
| **即时通讯** | Telegram、Discord、Slack、WhatsApp、Signal、Matrix、IRC |
| **中国平台** | 微信、企业微信、钉钉、飞书、QQ |
| **社交平台** | Facebook Messenger、Twitter/X |
| **协作工具** | Microsoft Teams、Google Chat、Mattermost |
| **其他** | Email、SMS、Webhook、Nostr、Zalo、BlueBubbles |

每个通道支持完整的消息收发、交互卡片、文件传输，自动适配平台特性。

---

## ⚙️ 服务部署

支持将 Liri 后端安装为系统自启服务，**开机自动运行、崩溃自动重启**，适合生产环境长期运行。

### 三平台一键部署

```bash
# 1. 进入应用目录，编译为独立二进制
cd app
bun run build:win:coding   # Windows（编程版）
bun run build:mac          # macOS
bun run build:linux        # Linux

# 2. 安装为系统服务（只需执行一次）
bun run service:install

# 3. 查看运行状态
bun run service:status
```

### 底层机制

| 平台 | 底层机制 | 自动启停 | 开机自启 |
|------|---------|---------|---------|
| **Windows** | `schtasks` 任务计划程序 | ✅ | ✅（BootTrigger） |
| **macOS** | `launchd` LaunchAgent | ✅ | ✅（RunAtLoad + KeepAlive） |
| **Linux** | `systemd` service | ✅ | ✅（WantedBy=multi-user.target） |

### 服务管理

```bash
bun run service:start     # 启动服务
bun run service:stop      # 停止服务
bun run service:restart   # 重启服务
bun run service:status    # 查看状态
bun run service:uninstall # 卸载服务
bun run service:dev       # 开发模式（无需编译，直接 bun run）
```

> 部署为服务后，Liri 将在后台持续运行，通过已配置的消息通道（Telegram、Discord、微信等）与你交互。
> 详细部署文档：[守护进程模块](app/src/daemon/README.md)

---

## 📖 文档

完整文档位于 `app/docs/` 目录：

| 文档 | 说明 |
|------|------|
| [🚀 快速入门](app/docs/快速入门/index.md) | 安装配置 |
| [📖 安装部署](app/docs/安装部署/index.md) | 三平台安装与 Docker |
| [📚 完整命令参考](app/docs/USAGE.md) | 全部命令详解 |
| [🔧 工具参考](app/docs/工具参考/index.md) | 每个工具的用法 |
| [🌐 渠道指南](app/docs/渠道/index.md) | 消息平台接入 |
| [🧩 插件开发](app/docs/插件系统/index.md) | 插件 SDK 与市场 |
| [💻 开发指南](app/docs/开发指南/index.md) | 二次开发 |
| [🏗 架构设计](app/docs/概念与架构/architecture.md) | 系统架构 |

---

## 🏗 项目结构

```
Liri/                            # 工程根目录
├── app/                         # 主应用（TypeScript + Bun）
│   ├── src/                     # 源代码
│   │   ├── main.ts              # 应用启动入口（launch 函数）
│   │   ├── entrypoints/         # 运行模式入口
│   │   │   ├── cli.tsx          # CLI 模式
│   │   │   ├── repl.ts          # REPL 模式
│   │   │   └── mcp.ts           # MCP Server 模式
│   │   ├── modules/             # 模块系统（注册表 + 初始化 + 延迟加载）
│   │   ├── core/                # 核心基础设施
│   │   │   ├── gateway/         # 消息网关
│   │   │   ├── session/         # 会话管理
│   │   │   ├── storage/         # 存储抽象
│   │   │   ├── permission/      # 权限控制
│   │   │   ├── events/          # 事件总线
│   │   │   ├── lifecycle/       # 生命周期管理
│   │   │   ├── cache/           # 缓存抽象
│   │   │   └── tokenBudget/     # Token 预算控制
│   │   ├── acp/                 # Agent Communication Protocol
│   │   ├── ai/                  # AI 模型适配层
│   │   ├── agent/               # AI Agent 核心
│   │   ├── tools/               # 100+ 工具实现
│   │   ├── channels/            # 26+ 消息通道
│   │   ├── mcp/                 # MCP 协议实现
│   │   ├── security/            # 安全防护体系（5 层）
│   │   ├── plugins/             # 插件系统
│   │   ├── skills/              # 技能系统
│   │   ├── memory/              # 记忆与知识库
│   │   ├── monitoring/          # 可观测性
│   │   ├── sandbox/             # 沙箱环境
│   │   ├── chronos/             # 定时任务调度
│   │   ├── cli/                 # 命令行交互
│   │   ├── bridge/              # 远程桥接控制
│   │   ├── config/              # 配置管理
│   │   ├── daemon/              # 守护进程
│   │   ├── bootstrap/           # 启动引导
│   │   └── context/             # 上下文引擎
│   ├── native/                  # Rust 原生模块（FFI）
│   ├── docs/                    # 完整中文文档
│   └── package.json
├── client/                      # 桌面客户端（Tauri v2 + React）
└── .github/workflows/           # CI/CD 自动化
```

---

## 🖥 桌面客户端

`client/` 目录包含基于 **Tauri v2 + React** 的桌面客户端：

```bash
cd client
bun install
bun run tauri dev
```

---

## 🏗 构建变体

适应不同使用场景的构建配置：

```bash
bun run build:core        # 核心版（最小功能集）
bun run build:personal    # 个人版
bun run build:coding      # 编程版（面向开发者）
bun run build:enterprise  # 企业版（全功能）
```

---

## 🚀 核心优势

### 强大的 Agent 引擎

基于 **TAOR（Think-Act-Observe-Reason）循环**的 Agent 架构，支持自主规划-执行-观察的闭环决策。内置 4 种检查点机制（CheckpointManager），确保长时间运行任务的可靠性。支持 DeepSeek、OpenAI、Ollama 等多种模型，流式输出实时展示思考过程。

### 100+ 内置工具

覆盖文件操作、命令执行、网络能力、媒体处理、编程辅助、Agent 协作、任务管理等场景。工具系统采用三层架构（工具定义 → 权限控制 → 沙箱执行），每个工具均可单独授权和审计。

### 5 层安全防护

从 **Rust AST 编译时分析**到 **Docker 沙箱隔离**，构建纵深防御体系：
- 40+ 命令语义模式数据库，识别危险操作
- 细粒度权限控制，支持按工具/按通道授权
- 完整审计日志，所有操作可追溯
- 速率限制与会话风险行为追踪

### 26+ 消息渠道

支持 Discord、Slack、Telegram、QQ、微信、钉钉、飞书、邮件、IRC、WhatsApp、Signal 等 26 个主流消息平台，统一协议帧和路由管理，一次接入全渠道触达。

### 企业级可观测性

内置完整的监控体系：指标采集、链路追踪、告警规则（含预设）、事件管理、健康检查、备份管理、数据归档、仪表盘。支持 OpenTelemetry 标准集成。

### 桌面客户端

基于 **Tauri v2 + React** 构建的跨平台桌面客户端，提供原生桌面体验。支持全局快捷键、系统托盘、自动更新，让 AI 助手随时在侧。

### 4 种构建变体

适应不同场景：**核心版**（最小功能集）、**个人版**、**编程版**（面向开发者）、**企业版**（全功能）。按需选择，轻量高效。

### 插件与技能系统

标准插件 SDK，支持插件市场和本地加载。技能系统支持条件触发和自动编排，让 AI 自主决策调用哪些能力。

---

## 📋 版本

当前版本：**v0.4.38**

版本管理遵循 [语义化版本规范](.trae/rules/versioning.md)：
- 修订号 — 按需升，每次发版 +1（Bug 修复、文档更新、小重构）
- 次版本 — 每月/每迭代 +1，修订号归零（新增功能、新通道接入、架构重构）
- 主版本 — 达到 v1.0.0 标准时一次性从 0.x.x 跳到 1.0.0

### 🚀 版本更新记录

#### v0.4.38 (2026-08-15)

**稳定性与 CI**
- ✅ **CI 全绿** — E2E 故障注入测试、三平台 Test Suite、静态检查全通过
- ✅ **E2E 适配新 UI** - Agent 任务管理迁移至 /agent 页面，重写对应测试
- ✅ **版本号一致性** - sync-version.ts 统一同步 6+ 版本文件

#### v0.4.37 (2026-08-14)

**会话链路与稳定性**
- ✅ **会话链路排查** - TAORLoop 污染、水位告警降噪、估算系数校准、删除 404 修复
- ✅ **压缩超时根治** - 超时保护收敛到 Tier3、保留 Tier2 成果、60s 上限、2560 摘要窗口
- ✅ **会话不物理删除** - SSE 鉴权白名单、fetch 补充 Bearer
- ✅ **知识库编码支持** - GBK/GB18030 编码自动检测

#### v0.2.0 (2026-06-05)

**新增核心能力**
- ✅ **知识库语义索引** - 支持文档向量化、语义检索
- ✅ **MCP 断线重连** - 流式传输 + 自动重连机制
- ✅ **Cron 定时任务调度** - 完整的计划任务系统
- ✅ **Agent 任务中心** - PDCA 长程编排、Kanban 看板
- ✅ **消息通道扩展** - QQ/飞书/微信等 26+ 平台接入
- ✅ **查询上下文引擎** - 智能上下文管理与修复工具

**架构升级**
- 路径管理架构重构，部署更安全
- 梦境引擎与守护进程分离

---

## 🙏 致谢

Liri 的诞生离不开 AI Agent 领域众多先行者的启发。在此致以诚挚感谢：

### 参考与对标项目

| 项目 | 贡献 |
|------|------|
| [OpenClaw](https://github.com/tsotnikov/openclaw) | 多通道 AI 网关架构、ACP 协议设计的对标参考 |
| [Hermes Agent](https://github.com/NEXUS-Bots/Hermes) | 自改进 AI 代理、ContextEngine 压缩策略的对标参考 |
| [Codex](https://github.com/openai/codex) | Rust 编码引擎、Sandbox 容器隔离的参考 |
| [Cline](https://github.com/cline/cline) | VS Code AI 插件模式、MCP 集成的参考 |

### 平台与框架

| 项目 | 贡献 |
|------|------|
| [Microsoft](https://www.microsoft.com) | TypeScript 语言、VS Code 编辑器、AutoGen 多代理框架等基础设施 |
| [GitHub](https://github.com) | 代码托管、GitHub Actions CI/CD、Copilot 推动 AI 编码革命 |
| [OpenTelemetry](https://opentelemetry.io) | 可观测性标准与 SDK，支撑应用监控与性能分析 |
| [Bun](https://bun.sh)（Oven.sh） | 高性能 JavaScript 运行时与工具链 |
| [Tauri](https://tauri.app) | 轻量级桌面客户端框架 |
| [React + Ink](https://github.com/vadimdemedes/ink) | 终端 UI 渲染方案 |

### 个人致谢

特别感谢 [Andrej Karpathy](https://github.com/karpathy) 等先行者在 AI Agent、LLM 应用和开源领域的开创性工作，为整个社区指明了方向。

感谢我人生中遇到的每一个人——家人、朋友、同事、同学。

你们的陪伴、启发、支持和包容,塑造了今天的我和这个项目。每一行代码背后,都有你们留下的痕迹。

谢谢你们。

---

## 🤝 贡献

项目正处于积极开发阶段。欢迎通过 Issue 反馈问题、提交 Feature Request 或贡献代码。

---

<div align="center">

**Liri · OpenLiri** — MIT License

让你的终端和消息应用都装上 AI 大脑

</div>
