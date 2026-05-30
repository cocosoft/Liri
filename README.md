<div align="center">

# PY_APP

**终端里的 AI 智能体 · 连接 26+ 平台的智能助手**

一键安装 · 自然语言交互 · 60+ 内置工具 · 企业级安全

[![CI Status](https://github.com/190615273/PY_APP/actions/workflows/ci.yml/badge.svg)](https://github.com/190615273/PY_APP/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![Version](https://img.shields.io/badge/version-0.1.0-blue)

[快速开始](#-快速开始) •
[功能概览](#-功能概览) •
[运行模式](#-运行模式) •
[渠道生态](#-渠道生态) •
[文档](#-文档)

</div>

---

## 🎯 这是什么

PY_APP 是一个运行在终端中的 **AI 智能助手**。你用它做什么？

- **终端里的编程搭档** — 在命令行中自然语言对话，读代码、搜文件、写脚本、查文档
- **跨平台消息机器人** — 接入 Telegram、Discord、微信、钉钉、Slack 等 26+ 平台，一处部署处处可用
- **可编程 AI 工作流** — 插件系统 + 技能系统 + 定时任务，构建属于你的自动化流程
- **安全的命令执行环境** — Rust AST 级安全分析 + 沙箱隔离，让 AI 安全地操作你的系统

> ⚡ **一行命令启动**：`cd app && bun install && cp .env.example .env` 填入 API Key，即可开始对话

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

### 配置自己的 AI 模型

支持 DeepSeek、OpenAI、Anthropic Claude、Ollama（本地）、Azure、Vertex 等多种模型，修改 `.env` 即可切换。

---

## ✨ 功能概览

### 🤖 AI 对话引擎

| 能力 | 说明 |
|------|------|
| 多模型支持 | DeepSeek / OpenAI / Anthropic / Ollama / Azure / Vertex |
| 多轮对话 | 完整会话管理，支持上下文记忆 |
| 思维链 | Agent 自主规划-执行-观察循环（TAOR），5 种停止条件 |
| 流式输出 | 实时显示 AI 思考过程 |
| Token 预算 | 三级预算控制（Warning / Critical / Hard），防止超额 |

### 🛠 60+ 内置工具

| 分类 | 工具 |
|------|------|
| 📁 文件操作 | 读写文件、搜索替换、glob 匹配、代码分析 |
| ⚡ 命令执行 | Bash 沙箱执行、安全分析、权限控制 |
| 🌐 网络能力 | 网页抓取(HTML→Markdown)、搜索引擎查询 |
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

- 标准插件 SDK（`@pyapp/core` / `@pyapp/personal` / `@pyapp/coding` / 企业版）
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

一次部署，连接所有平台。PY_APP 支持 **26+ 消息通道**，配置环境变量即可启用：

| 区域 | 通道 |
|------|------|
| **即时通讯** | Telegram、Discord、Slack、WhatsApp、Signal、Matrix、IRC |
| **中国平台** | 微信、企业微信、钉钉、飞书、QQ |
| **社交平台** | Facebook Messenger、Twitter/X |
| **协作工具** | Microsoft Teams、Google Chat、Mattermost |
| **其他** | Email、SMS、Webhook、Nostr、Zalo、BlueBubbles、Claude |

每个通道支持完整的消息收发、交互卡片、文件传输，自动适配平台特性。

---

## 📖 文档

完整文档位于 `app/docs/` 目录：

| 文档 | 说明 |
|------|------|
| [📖 用户引导](app/docs/用户引导/guide.md) | 新手上路 |
| [🚀 快速入门](app/docs/快速入门/index.md) | 安装配置 |
| [📚 完整命令参考](app/docs/USAGE.md) | 全部命令详解 |
| [🔧 工具参考](app/docs/工具参考/index.md) | 每个工具的用法 |
| [🧩 插件开发](app/docs/插件系统/index.md) | 插件 SDK 与市场 |
| [💻 开发指南](app/docs/开发指南/index.md) | 二次开发 |
| [🏗 架构设计](app/docs/概念与架构/architecture.md) | 系统架构 |

---

## 🏗 项目结构

```
PY_APP/
├── app/                    # 主应用（TypeScript + Bun）
│   ├── src/                # 源代码
│   │   ├── main.ts             # 入口（launch 函数）
│   │   ├── agent/              # AI Agent 核心
│   │   ├── tools/              # 60+ 工具实现
│   │   ├── channels/           # 26+ 消息通道
│   │   ├── mcp/                # MCP 协议实现
│   │   ├── security/           # 安全防护体系
│   │   ├── plugins/            # 插件系统
│   │   ├── skills/             # 技能系统
│   │   ├── session/            # 会话管理
│   │   ├── chronos/            # 定时任务
│   │   ├── cli/                # 命令行交互
│   │   └── entrypoints/        # 4 种运行模式入口
│   ├── native/             # Rust 原生模块（FFI）
│   ├── docs/               # 完整中文文档
│   ├── configs/            # 应用配置
│   └── package.json
├── client/                 # 桌面客户端（Tauri v2 + React）
└── .github/workflows/      # CI/CD 自动化
```

---

## 🖥 桌面客户端

`client/` 目录包含基于 **Tauri v2 + React** 的桌面客户端：

```bash
cd client
npm install
npm run tauri dev
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

## 📊 对标分析

PY_APP 与行业同类项目进行了**系统性对标**，对标对象为 **Hermes v0.12.0**（Nous Research，自改进 AI Agent）和 **OpenClaw v2026.4.30**（多渠道 AI 网关）。对标采用四阶段法（清单编制 → 深度阅读 → 维度提取 → 逐维对比），覆盖 12 个关键维度。

### 综合评分

| 维度 | PY_APP | Hermes | OpenClaw |
|------|:-----:|:------:|:--------:|
| D1 Agent 引擎 | ✅ 完善 | ✅✅ 成熟 | ✅ 完善 |
| D2 消息渠道 | ✅✅ 19 通道 | ✅✅ 18+ 平台 | ⚠️ 框架级 |
| D3 CLI 交互 | ✅✅ 70+ 命令 + Ink 自渲染 | ✅✅ prompt_toolkit TUI | ✅✅ 60+ 文件 |
| D4 工具系统 | ✅✅ 三层架构 | ✅✅ 20+ 预置 | ✅✅ bash-tools |
| D5 MCP 协议 | ✅ 完整 6 传输层 | ⚠️ 依赖 SDK | ✅✅ 最完整 |
| D6 ACP 协议 | ✅✅ client + server | ✅ 基础支持 | ✅✅ 最完整 |
| D7 安全体系 | ✅✅ 50+ 文件全子系统 | ⚠️ 基本 guardrails | ✅✅ Docker 沙箱 |
| D8 插件/技能 | ✅ 10+ 预装 + 5 加载器 | ✅✅ 12+ 技能 | ✅✅ 技能市场 |
| D9 定时任务 | ✅ Chronos + tasks | ⚠️ 基础 scheduler | ✅✅ cron 全链路 |
| D10 配置系统 | ✅ Schema + 热重载 | ⚠️ YAML + .env | ✅✅ 50+ 类型定义 |
| D11 守护进程 | ✅ ProcessManager | ❌ 缺失 | ✅✅ 全平台支持 |
| D12 构建部署 | ✅✅ 多变体 + Tauri + CI/CD | ⚠️ pip extras | ⚠️ 无 CI |
| **综合** | **10/12** | **5/12** | **9.5/12** |

### 核心结论

1. **PY_APP 实际完成度与 OpenClaw 在同一梯队（10/12 vs 9.5/12）**，早期初步判断存在系统性低估（v1.0 评 2.5/12，经深入代码阅读后修正为 v2.0 的 10/12）
2. **全线对标不落下风，部分领域反超**：通道数量并列第一（19 vs 18）、安全体系完善度领先、CLI 命令丰富度领先、构建部署自动化（Tauri + CI/CD）对标产品所不具备
3. **独有差异化优势**：TAOR 检查点机制、Ink 自渲染引擎、Tauri 桌面客户端、4 种构建变体
4. **提升空间在"精致度"而非"缺失度"**：Slack/WhatsApp 2 个通道为 EventEmitter Shim 期待升级、配置文档生成、测试覆盖率等工程质量有提升空间

### PY_APP 独有优势

| 优势 | 竞争价值 |
|------|---------|
| 🚀 **TAOR 检查点机制**（4 种检查点 + CheckpointManager） | 长时间 Agent 任务可靠性，对标产品均无 |
| 🚀 **Ink 自渲染引擎**（25+ 文件，不依赖外部 ink 包） | 降低依赖风险，深度终端 UI 定制能力 |
| 🚀 **5 层安全体系**（50+ 文件，12 个子系统已落地） | 安全完善度远超对标产品 |
| 🚀 **4 种构建变体**（core/personal/coding/enterprise） | 差异化分发能力，对标产品无 |
| 🚀 **Tauri 桌面客户端**（React + Rust 原生应用） | AI Agent 平台唯一桌面客户端 |
| 🚀 **70+ 内置命令**（命令系统最丰富） | 开箱即用体验领先 |
| 🚀 **GitHub Actions CI/CD**（5 个 job + 安全扫描 + 覆盖检查） | 质量自动化领先 |

> 📖 完整对标分析报告见 [dev_docs/20260530/benchmark-report.md](dev_docs/20260530/benchmark-report.md)，优化完善路线图见 [dev_docs/20260530/improvement-plan.md](dev_docs/20260530/improvement-plan.md)

---

## 📋 版本

当前版本：**v0.1.0**（开发阶段）

版本管理遵循 [语义化版本规范](.trae/rules/versioning.md)：
- 每次提交递增修订号
- 修订号达 100 进位次版本
- 次版本达 10 进位主版本

---

## 🙏 致谢

PY_APP 的诞生离不开 AI Agent 领域众多先行者的启发。在此致以诚挚感谢：

### 参考与对标项目

| 项目 | 贡献 |
|------|------|
| [Claude Code](https://github.com/anthropics/claude-code)（Anthropic） | Agent 架构、命令系统、安全分析等方面的核心参考 |
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

---

## 🤝 贡献

项目正处于积极开发阶段。欢迎通过 Issue 反馈问题、提交 Feature Request 或贡献代码。

---

<div align="center">

**PY_APP** — MIT License

让你的终端和消息应用都装上 AI 大脑

</div>
