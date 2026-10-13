<div align="center">

<img src="app/assets/logo.png" alt="Liri Logo" width="120" />

# Liri · OpenLiri

> 玲珑鸟 · 你的 AI 私人助手
> 官网：https://openliri.com

**终端里的 AI 智能体 · 连接 26 个平台的智能助手**

一键安装 · 自然语言交互 · 75 个内置工具 · 企业级安全

[![CI Status](https://github.com/cocosoft/Liri/actions/workflows/ci.yml/badge.svg)](https://github.com/cocosoft/Liri/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![Version](https://img.shields.io/badge/version-0.4.96-blue)

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

拥有 65 个模块化子系统、4 阶段分层启动、三级延迟加载策略、多智能体通信协议（ACP），以及完整的安全沙箱与可观测性体系。

---

## 🌟 为什么是 Liri

多数 Agent 项目"能跑通"，Liri 更在意**跑得住、查得清、改得动**。以下 6 条是本项目的工程取向，且都**有代码与门禁兜底**（不是口号）：

| # | 特点 | 具体做法（可核对） |
|---|------|------------------|
| 1 | **可复现优先** | 凡**进入模型请求**的内容（提示词、工具清单、注入上下文、检索结果）都必须落为**会话事件**（`events.jsonl`），可重建、回放、审计。事件类型的三处登记由**编译期**强制 —— 漏登记直接 `TS2322` 编译失败 |
| 2 | **写前持久化（Write-Ahead）** | 渲染所依赖的数据**先落盘再渲染**；工具调用完成/失败、输出截断、会话切换等关键节点**即时**落盘（非防抖），切换会话前 `flush` 且带超时保护 |
| 3 | **自带评测与回归门禁** | 能力评测**内建**于仓库：38 题基线逐题登记地板，含**成对安全测量**（7 攻击变体 + 1 良性对照）与**判分器自检控制题**；支持 `pass^k` 重复运行可靠性口径（详见下文） |
| 4 | **架构门禁化** | 六层分层（`entry > ui > app > service > infra > core`）+ 可执行门禁 `lint:arch`：跨层违规、基础设施重复实现、数据模型分叉、单文件超长等均**脚本化检查**，当前**违规 0** |
| 5 | **数据库是唯一事实来源** | 模型、供应商、定价、上下文窗口、能力标签全部读 DB；**禁止**按模型名硬编码属性表（如"某模型上下文 200K"这类表）与硬编码供应商名 |
| 6 | **用真实语料自测** | 检索基准以**仓库自身文档**（143 篇真实文档）为语料，输出 `recall@k` / `MRR` / 延迟，而非假数据自证；语料为空直接**报错**而非回退模拟数据 |

> 这意味着：Liri 的每一次模型调用**事后都能回答"当时的上下文是什么"**；每一次能力变化**都能被门禁拦下**；每一条性能/质量数字**都能被重跑复现**。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| **运行时** | Bun（主要）/ Node.js |
| **语言** | TypeScript（≈99.6%，约 111 万行）+ Rust（≈0.4%，约 4.3 千行原生模块） |
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
| 多模型支持 | DeepSeek / OpenAI / Ollama / Azure / Vertex，模型与定价以数据库为唯一事实来源 |
| 多轮对话 | 完整会话管理，支持上下文记忆与跨会话检索 |
| 思维链 | Agent 自主规划-执行-观察循环（TAOR），5 种停止条件 |
| 流式输出 | 实时显示 AI 思考过程 |
| 上下文治理 | 分层切窗 + 按需取回原文 + 自动压缩（详见下文） |
| Token 预算 | 多级预算控制（预警 / 压缩 / 阻断），防止超额 |

Agent 引擎内置 4 种检查点机制，长时间运行的任务可落盘续跑；工具调用轮次、压缩、截断等关键节点均写事件日志，支持回放与审计。

### 🛠 内置工具（75 个）

| 分类 | 工具 |
|------|------|
| 📁 文件操作 | 读写文件、搜索替换、glob 匹配、代码分析 |
| ⚡ 命令执行 | Bash 沙箱执行、安全分析、权限控制 |
| 🌐 网络能力 | 网页抓取（HTML→Markdown）、搜索引擎查询 |
| 🖼 媒体处理 | 图片生成/处理、语音合成/识别、视频生成、PDF 解析 |
| 💻 编程辅助 | LSP 智能提示、代码执行、Notebook 编辑 |
| 🧩 Agent 协作 | 子代理（SubAgent）异步执行、技能编排 |
| 📋 任务管理 | 待办事项、任务全生命周期管理、定时任务调度、自唤醒（`sleep_for` / `sleep_until`） |
| 🔌 MCP 工具 | Model Context Protocol 客户端/服务器、认证管理 |
| 💬 会话工具 | 会话管理、日志转录、父子会话衍生 |
| 🔧 系统工具 | 时间/日期、监控指标、系统诊断 |

工具按构建变体的能力开关动态注册（同一份源码，按 core / personal / coding / enterprise 裁剪），注册清单单一来源为 `app/src/tools/utils/ToolManagerUtils.ts`。

> **计数事实源**：`app/src/constants/toolNames.generated.ts` 的 `TOOL_NAMES_COUNT`（由 `getAllBuiltinToolLoaders()` **全量视图**生成，含条件工具 ⇒ 与构建变体/环境无关）。改动工具清单后运行 `bun run gen:toolnames` 重新生成，本处数字随之同步。

### ⏱ 长任务与等待态可见性

长等待（自唤醒、定时任务、外部事件）不再"看起来没反应"：

- **到点自动续跑** — `sleep_for` / `sleep_until` 与定时任务触发后，服务端在**原会话**内继续执行，不新建会话
- **等待中可见** — 前端浮动栏显示「⏳ 等待中，预计 N 秒后自动继续」，倒计时实时递减
- **不丢唤醒** — 唤醒登记为"读取 → 追加 → 合并写"，并发登记不会互相覆盖

### 💰 用量归因与成本

- **真实模型归因** — 每次调用记录 provider 回显的真实模型名，成本按真实价格表计算（模型回显缺失时才退回调用方指定值）
- **预估 vs 实测** — 每轮输出"估算 tokens vs provider 真实 usage"对比日志，估算偏差可观测
- **每日预算** — 全局与批处理各自的每日 Token 预算，接近上限时前置预警并按需降级

### 🧠 上下文窗口治理

- **分层切窗** — 超窗大会话先丢头部旧轮次，构建期内存 O(全量) → O(窗口)
- **按需取回** — 切窗时注入"原文可取回"提示，配套取回工具按页读回细节
- **窗口取自模型注册表** — 上下文窗口 / 能力来自数据库（非按模型名硬编码表）；发送前的切窗与压缩按**本轮真实模型**的窗口计算
- **自动压缩** — 按 token 水位自动压缩（同步 Tier1/2 + 后台 Tier3），并保留压缩前后水位日志

### 📊 企业级可观测性

内置监控体系：指标采集、链路追踪（OpenTelemetry Tracing + Metrics）、告警规则（含预设）、事件管理、健康检查、备份管理、数据归档、仪表盘。

LLM 请求链路已对齐 **OTel GenAI 语义约定**：在自有的 `Liri.*` 属性之外**并存**写入 `gen_ai.operation.name` / `gen_ai.request.model` / `gen_ai.usage.input_tokens` / `gen_ai.usage.output_tokens`，使 trace 可被标准 GenAI 观测工具直接消费。命名采用**"先新增、后改名"**策略：先并存双写，待客户端与门禁同批就绪再切换，避免破坏既有 trace 视图与去重键。内容类属性（`gen_ai.input.messages` 等）按规范**默认不采集**。

### 🔒 五层安全防护

```
Rust AST 编译时分析 → TypeScript 语义分析 → Guardrail 规则引擎 → AutoMode 分类器 → Sandbox 沙箱隔离
```

- **命令安全模式库** — 危险命令 725 条、敏感路径 138 条、环境变量污染 153 条、零宽字符 177 条
- 细粒度权限控制，支持按工具 / 按通道授权
- 完整审计日志，所有操作可追溯
- 速率限制与会话风险行为追踪
- **注入攻防可量化**（内置评测）— 提示注入按"**成对测量**"设计：同一场景下 7 个攻击变体（权威冒充 / 任务劫持 / 角色扮演 / 编码绕过 / 延迟触发 / 工具形态诱导等）+ 1 个良性对照，同时报告 **ASR**（攻击成功率，越低越好）与 **benign utility**（正常任务完成率，其降幅即**误伤**）；并按 **Max 口径**统计"有多少**场景**被攻破"（同一场景任一载荷得手即计入），避免只看单次尝试而低估风险

### 🧩 插件与技能系统

- 标准插件 SDK（`@liri/core` / `@liri/personal` / `@liri/coding` / 企业版）
- 插件市场支持，本地和 npm 来源
- 完整的生命周期管理（激活、停用、热加载）
- 技能系统：内置 / 用户 / 第三方市场三来源物理隔离，支持条件触发与自动编排

### 🧪 评测与回归门禁（内建，非外挂）

评测体系与主仓**同一代码库、同一门禁**，随 `bun test` / `--gate` 一起复跑：

| 能力 | 说明 |
|------|------|
| **真实任务级回归** | 从本仓 git 历史取**真实修复提交**，**双实测**筛选（**起点必须真红、修复后必须真绿**），跑测试前**重放测试文件**防篡改；判据为 JUnit **三态**（通过 / 失败 / 跳过） |
| **F2P / P2P 分解** | 单次运行即得逐用例结果，自动派生 `FAIL_TO_PASS`（起点红→修后绿）与 `PASS_TO_PASS`（起点绿→保持绿），据此判定 `resolved` / `breaking` / `no-op` |
| **判分器自检** | 必须存在**控制任务**且被正确判为"不合格" —— 防止判分器恒真而"看起来全过" |
| **可靠性口径 `pass^k`** | 同一任务跑 k 次，除 `pass^1`（单次成功率）外输出 `pass^k = C(c,k)/C(n,k)` 的**组合式无偏估计**与**可靠性曲线**，刻画"稳定复现"而非"偶尔成功" |
| **安全成对测量** | 7 攻击变体 + 1 良性对照，同时看 ASR 与误伤（见上节） |
| **基线门禁** | `baseline.json` 逐题登记地板（`requirePassK` / `minPass1`），**刻意不绑定模型名**；出现波动须先以 `k≥4` 复测，**不得直接放宽阈值** |
| **题集分层** | 默认题集之外，源派生 / 真实修复类题集由**显式开关**纳入，避免未验证题目污染门禁 |

### 🔁 可复现与回放

- **事件日志为事实源** — 会话以追加式事件（`events.jsonl`）记录，消息与 UI 视图均由事件**派生**，支持回放与审计
- **"模型可见 ⇔ 已落盘"红线** — 任何新增的"模型可见输入"若未落为事件，即视为**破坏可复现性**；该约束由类型系统 + 登记清单**穷尽断言**在**编译期**守住
- **关键节点即时落盘** — 工具调用完成 / 失败、流截断、会话切换前均**同步**落盘（切换带超时保护），杜绝"内存有、盘上没有"

### 📚 知识库与知识图谱

- **文档检索** — SQLite + **FTS5** 全文索引、标题倒排、关键词倒排；结果带类型标注（`keyword` / `title` / `directory` / `semantic`）
- **混合检索** — 关键词与向量两路结果按 **RRF（Reciprocal Rank Fusion）** 融合，权重与阈值可配
- **知识图谱** — 实体 / 关系持久化到同一 `app.db`，支持按域（domain）过滤与 JSONL 导入导出，**域字段全程保真**（建 / 查 / 导出同一口径）
- **真实语料基准** — 以仓库自身**143 篇文档**为语料，自建冷缓存对照 `exact-title` / `keyword` 等模式，输出 `recall@1/5/10` · `MRR` · 延迟中位数；**不可得模式显式标记"不可用 + 原因"**，不填 0 冒充

### 🤝 多智能体协作与工作流

- **Agent 注册表** — 取代协作器内部的硬编码 Agent 列表，支持发现与动态注册
- **协作编排** — 议事（`CouncilOrchestrator`）、蜂群（`AgentSwarm`，位于 `tasks/swarm/`）、链式（仅有 `CHAIN_*` 事件，**无** `AgentChain` 类）多种编排形态；构造点收敛为**模块内单例**，避免同一编排器多处 `new` 导致状态分叉
- **文档工作流** — 分阶段执行、默认格式、图片并发与失败降级等均可配（`DocWorkflow`）
- **PDCA 工作流** — 计划-执行-检查-处理闭环，进度以独立消息块实时呈现

### 🌐 协议面

| 协议 | 用途 | 状态 |
|------|------|------|
| **MCP** | 作为客户端接入外部工具；亦可作为 MCP Server 供他方调用 | ✅ |
| **ACP** | Agent 间通信协议 | ✅ |
| **A2A** | 对外 Agent 互操作：Agent Card 发现（`/.well-known/agent-card.json`）、任务委派与状态查询；命名已对齐 **v1.0.0**（`TASK_STATE_*`） | ✅（默认关闭，需显式启用） |
| **LSP** | 代码智能提示 | ✅ |

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

一次部署，连接所有平台。Liri 支持 **26 个消息通道**，配置环境变量即可启用：

| 区域 | 通道 |
|------|------|
| **即时通讯** | Telegram、Discord、Slack、WhatsApp、Signal、Matrix、IRC、Line |
| **中国平台** | 微信、企业微信、钉钉、飞书、QQ、元宝 |
| **社交平台** | Facebook Messenger、Twitter/X |
| **协作工具** | Microsoft Teams、Google Chat、Mattermost |
| **其他** | Email、SMS、Webhook、Nostr、Zalo、BlueBubbles、Claude |

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
│   │   │   ├── repl.ts          # REPL 模式
│   │   │   └── mcp.ts           # MCP Server 模式
│   │   ├── modules/             # 模块系统（注册表 + 初始化 + 延迟加载）
│   │   ├── core/                # 核心基础设施
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
│   │   ├── tools/               # 内置工具实现（75 个）
│   │   ├── channels/            # 26 个消息通道
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

## 📋 版本

当前版本：**v0.4.96**

版本管理遵循 [语义化版本规范](.trae/rules/versioning.md)：
- 修订号 — 按需升，每次发版 +1（Bug 修复、文档更新、小重构）
- 次版本 — 每月/每迭代 +1，修订号归零（新增功能、新通道接入、架构重构）
- 主版本 — 达到 v1.0.0 标准时一次性从 0.x.x 跳到 1.0.0

### 🚀 版本更新记录

#### v0.4.96 (2026-10-13)  状态机规范管理：阶段 1（定义目录 → 取值取证 → 登记硬门禁） 
- ✅ **阶段 1：状态机定义目录（`StateMachineCatalog`）** - **方案订正（重要）**：`state/engine/StateMachineRegistry.ts` 实为**运行时实例**注册表（按 id 存实例 / `gc` / `find`），**不是**定义目录 ⇒ 原表述「把状态机接入 `StateMachineRegistry`」属**类别错误**，订正为「登记到**定义目录**」。新增 `state/engine/stateMachineCatalog.ts`（**零依赖纯数据 + 只读查询**，避免 `core←service` 倒挂）；首版先落 Execution / ToolCall 两条（取值逐项与源码枚举核对），余项以显式占位登记 —— **占位部分已由下一条（1.3 取证）全部取代**。**零语义变更**（不动任何域枚举/转移）。证据 `FSM-CATALOG-P1`
- ✅ **阶段 1.3：状态取值取证完成（12 条全部登记）** - 9 台机器 + `SimplifiedSessionState` **全部取证**迁入 `STATE_MACHINES`（取值 + `sourceFile` + `verification` 口径）。其中 **5 条有运行时锚点**（`EXECUTION_STATUSES` / `TOOL_CALL_STATUSES` / `AppState` / `SessionState` / `TaskStatus`）⇒ 测试**动态载入逐项比对**（防漂移，实测全等）；其余 **7 条**仅有类型联合或内联字面量 ⇒ **源码阅读取证**并**如实标注** `source-read`（不谎称有机器校验）。另新增 `BOUNDARY_STATE_MACHINES` **4 条同名不同物登记**（UI `TaskStatus` 词汇表 / `session/models` 类 / `GoalRunSettlement` / `AcpApprovalClass`，各附不合并理由）。测试 `tests/state/stateMachineCatalog.test.ts` **6 例**。证据 `FSM-CATALOG-P1`
- ✅ **阶段 1.3 配套：消除取证暴露的 3 项隐患** - ① 应用安装状态抽出 `export type AppInstallStatus`（消除 `appState/AppState.ts:253`/`:259` **两处内联字面量重复**）；② `awaiting_approval` 抽出常量 `TRANSIENT_AWAITING_APPROVAL`（原 `ToolExecutionService.ts:638/962` 裸字面量），`requires_approval` 裸比较改 **`ToolExecutionStatus.REQUIRES_APPROVAL` 枚举成员**（**不复制字面量**，守住「数出同源」）；③ `BudgetMode` 去 `DailyBudgetManager` 本地重声明 ⇒ **单一事实源** = `dailyBudgetSnapshot.ts`。新增**源码守卫** `tests/state/stateMachineHygiene.test.ts`（**3 例计数断言**，防回流；初版误用 `not.toContain` 自测失败 ⇒ 改计数后通过）。回归 `tests/state/ tests/query tests/chat` **747 pass / 0 fail**。证据 `FSM-CATALOG-HYGIENE`
- ✅ **阶段 1.4：状态机登记硬门禁（未登记 ⇒ 阻断构建）** - `scripts/lint-architecture.ts` 新增 `checkStateMachineRegistration()`（接入 `runAll`），规则 **R09-006（error）**：`app/src/**`（排除测试）中的 ① `export enum *Status|*State` ② `export const *_STATUSES|*_STATES = [ … ]`（含 `new Set([ … ])`）必须**要么**在定义目录 `state/engine/stateMachineCatalog.ts` 登记（`verifyRef` 精确锚点 **5 条** / `sourceFile` 文件级：`STATE_MACHINES` + `BOUNDARY_STATE_MACHINES`），**要么**在新建的显式豁免清单 `scripts/state-machine-allowlist.json`（**44 条，每条附 `reason`**）登记。**实测**：首次扫描 **候选 54 / 未登记 47** ⇒ 补 `sourceFile` 文件级豁免后 **44** ⇒ 落清单后 **候选 54 / 已登记 54 / 未登记 0**，`lint:arch` **错误 0**（4 基线警告未增）。**负向自证**：临时注入探针文件（`export enum ScratchProbeStatus` + `export const SCRATCH_PROBE_STATUSES`）⇒ 报 **2 条 error、退出码 1**（构建阻断），删除后复绿；**fail-closed 实测**：临时移走豁免清单 ⇒ 报「豁免清单缺失」error（退出码 1）。⚠️ **局限（如实，已写入规则与 docstring）**：仅识别 enum / `as const`(Set) 数组两类**有运行时锚点**形态；`type X = 'a' | 'b'` 类型联合与内联字面量**不在**范围（全仓逾 150 处，逐一豁免即噪音门禁，必无人维护）⇒ 由目录的 `source-read` 条目 + `stateMachineCatalog.test.ts` 人工取证覆盖（**只漏报、不误报**）。测试 `tests/state/stateMachineRegistrationGate.test.ts` **4 例**（非空且带 reason / 文件存在且确实导出该符号=**防陈旧豁免** / 键唯一 / 与目录锚点**不重叠**）；规则条文 `.trae/rules/architecture-compliance.md` 新增 **R09-006**（版本 1.6.0 → 1.6.1）。证据 `FSM-CATALOG-GATE14`
- ✅ **阶段 2：工具调用状态单一事实源（收敛 chunk/SSE 层 G14 分叉）** - **2.1 裁定**：① 工具调用状态的**唯一事实源** = `execution/types.ts` 的 `ToolCallStatus`（4 态，含恢复期 `unknown`）；`execution/index.ts` **补齐出口**（R03-002）—— 此前 `TOOL_CALL_*` 常量/类型**未**经模块出口暴露 ⇒ 消费者只能各自复写字面量（分叉根因）。② `ToolCallSpec.status`（HTTP 门面）与 `FrontendMessageBlock.toolCall.status`（前端消息块）**统一引用** `ToolCallStatus`（放宽含 `unknown` 属**零行为变更**：流式路径无该值生产者，生产者 = 恢复期回填）。③ **`SubAgentProgress.status` 裁定 ≠ 同一物**：属子 Agent 域，且 `utils` 为 **infra** 层、`allowedDependencies.infra = [infra, core]` ⇒ 引用 `execution`(**service**) 即**分层倒挂**（R00-001）⇒ 保持独立并加**边界注释**（对齐 `MessageAttachment` 判例）。**2.2 去裸值**：`execution/types.ts` 新增具名常量 `TOOL_CALL_COMPLETED_STATUS` / `TOOL_CALL_FAILED_STATUS`（对齐既有 `TOOL_CALL_INITIAL_STATUS` / `TOOL_CALL_UNKNOWN_STATUS` 的「避免裸字面量」先例）；`reactEventsToChunks.ts:92/130`、`chat-handlers.ts:873/1295`（两条 SSE 路径兜底）改引用常量；`CoreAPIImpl.ts:1001` **删除** `as { toolCall?: { status?: string } }` 结构断言（把状态类型降级为裸 `string` 的元凶——`chunk` 在该分支已收窄为 `ChatStreamChunk`）。**2.3 已随阶段 1.3 配套完成**（见 `FSM-CATALOG-HYGIENE`）。**验证**：新增源码守卫 `tests/state/toolCallStatusSingleSource.test.ts` **7 例**（出口暴露 / 两面引用同一类型 / chunk 层无裸值 / SSE 兜底常量 / 断言已删 / 子 Agent 不跨层）+ `tests/chat/reactEventsToChunks.test.ts` **+4 例**（常量取值锁 + `tool_start`/`tool_end(success)`/`tool_end(error)` 行为锁）；`lint:arch` **0 错**（R09-006 候选 **54 不变**）· `typecheck` **三工程全绿** · `lint:fn-size` / `lint:complexity` 未增长 · `bun test tests/state tests/chat tests/channels tests/query tests/session` **1496 pass / 0 fail**。⚠️ **零行为变更**（wire 取值 `running`/`completed`/`failed` 未变、无 DB / 无 wire 字段变更）；`e2eVerified=false`（未做真实浏览器长会话核对，如实标注）。证据 `FSM-TOOLSTATUS-P2`
- ✅ **阶段 3：会话状态机 8 态 → 3 态收敛（旧枚举删除 + 不可达兜底清理）** - **执行前取证（推翻方案前提，已报用户裁定）**：旧 8 态 `SessionState` **不是**遗留死码而是**活事实源**（`ChatManager:3184/3338` 的 `.start/.finish` · `ChatOrchestrator:754/1166` · **已接线**的 `SessionStateBridge`（`init.ts:479-490`）按 5 类生命周期事件驱动），而迁移目标 `SimplifiedSessionState` + `toSimplifiedState()` 经全仓取证**零生产消费者且未出口** ⇒ **用户裁定「按原文执行 8→3 合并」**（其信息降级代价已如实登记）。**落地**：`SESSION_TRANSITIONS` 重写为 3 态（`idle→running`；`running→idle/requires_action`；`requires_action→running/idle`，由旧表**逐边归并**）+ 折叠映射 `IDLE/COMPLETED/ARCHIVED/ABORTED→idle`、`RUNNING→running`、`REQUIRES_ACTION/PAUSED/ERROR→requires_action`（与 Phase 1 既定 `toSimplifiedState()` **逐值一致**）；**3 态下无终态**（`idle` 可再 `start()` ⇒ 成环，`isTerminal()` 恒 `false`）。**删除 3 类（均有取证）**：① 旧 8 态枚举本体（零消费者）；② `toSimplifiedState()`（8 态消失后**失输入类型**；且旧 8 态**不持久化**、`emitSessionStateChanged()` 零调用点 ⇒ 无迁移映射需求）；③ `SessionStateMachine.archive()`（3 态下 `ARCHIVED` 折叠为 `idle`、无独立目标，生产**零调用者**）。**CS03 清理**：`SessionStateBridge` 对 `complete()` 的 try/catch + `handleError` 导入**已删除** —— `complete()` 目标为 `idle`，3 态下**三者到 `idle` 均为合法边或幂等**且引擎内部已捕获钩子/监听器异常 ⇒ 该 catch **不可达**（原注释「忽略非 RUNNING 状态下 complete 失败」已失效）。⚠️ **同目标再触发不新增异常面（已证）**：引擎对 `from === to` **早返回 `true`**（`StateMachine.ts:188-194`）⇒ 折叠后「已在 `requires_action` 再 `pause()`/`error()`」为**幂等无操作**（旧 8 态表本就允许 `REQUIRES_ACTION→PAUSED/ERROR`）。**目录同步**：`sessionState` 条目改写为 3 态、运行时锚点由 enum 改为**转移表键**（新增 `anchor: 'objectKeys'` 变体）、`sessionStateSimplified` 并入；`BOUNDARY_STATE_MACHINES#sessionModelClass` 理由更新（**阶段 3 已处置：保持独立** —— 其 8 值词汇表用于**接受既有持久化值**，**只可放宽不可收紧**），并订正 `session/models/SessionState.ts` 中「对齐 8 状态枚举」的**失真注释**。**验证**：`tests/state/session/SessionStateMachine.test.ts` **重写 25 例**（转移表/折叠映射/幂等无操作/非法转移/成环生命周期/`archive()` 防回流）；`lint:arch` **0 错**（R09-006 候选 **54 → 53**，恰等于删除 1 个 `*State` 枚举，逐数吻合）· `typecheck` 三工程全绿 · `lint:fn-size`/`lint:complexity` 未增长 · `bun test tests/state tests/chat tests/session tests/channels tests/query` **1490 pass / 0 fail** · `lint:invariants`/`lint:doc-code`/`version:check` 全绿。ℹ️ **CD05/CD06 遵从**：本批改动**提交时应拆两个提交**（①迁移 ②删除），**回滚路径** = 按证据 `code` 清单整体 revert（无 DB / 无 wire / 无持久化格式变更）。`e2eVerified=false`（未做真实长会话的会话状态观测端到端核对）。证据 `FSM-SESSIONSTATE-P3`
- ✅ **阶段 4：四原语只读投影 + 异步 Outbound Broker（telemetry-gated）** - **方案订正（层禁，已回仓举证）**：原文「由 `StateMachineRegistry` 直接挂钩 lifecycle dispatch 管线」不可行 —— ① `state`(**infra**) **不可**引用 `execution`(**service**) 的 `ExecutionStatus`（R00-001 倒挂）；② `StateMachineRegistry` 本体只是**实例缓存**（`register/find/gc`），**不存在** dispatch 管线 ⇒ 改为**两层分工**（原措辞的「或专用 wrapper」备选口径）：**四原语词汇 + 载荷 + Broker** 落 `state/engine/projectionBroker.ts`（infra，**零域依赖**、只认原语），**域侧纯映射**落 `execution/executionProjection.ts`（service）。**§3 裁定逐条落实**：`PREPARED/RUNNING/SUSPENDED/SETTLED` 为**严格无状态、只读、带外广播投影**；**原生枚举不变**（`EXECUTION_STATUSES` 未改）；**不承载裁决**；**不暴露内部细粒度状态**（§4.3）—— 载荷**键集恒为** `{at, domain, primitive, sessionId}`（测试以键集 + 原生专属字面量缺席**双重锁定**）。**4.1 纯映射（编译期穷尽）**：`EXECUTION_STATUS_PROJECTION: Record<ExecutionStatus, ExecutionPrimitive>` —— `QUEUED→PREPARED`；`RUNNING/WAITING_USER/CANCEL_REQUESTED→RUNNING`（与 `isActiveStatus()` **同界**）；`CANCELLED/COMPLETED/FAILED/STALE→SETTLED`（与 `isTerminalStatus()` **同界**）；`WAITING_USER` **不**投 `SUSPENDED`（后者语义为预算挂起、尚未实现）。**4.2 唯一 choke point**：`ExecutionManager.emitStatus`（`acquire/requestCancel/confirmCancel/complete/fail/markStale` 共 **7 处**状态转移全经它）⇒ 仅一处接线即全覆盖，**无需逐点手工调用**。**4.3 复用既有 `globalEventBus`**（**无独立总线**）：新增事件名 `SystemEvents.STATE_PROJECTED = 'state:projected'`；`publish` 语义为 **fire-and-forget**（不 await、单监听器异常各自捕获 ⇒ 天然"异步带外、失败不回流"，另有抛错订阅者测试验证隔离）。**开关**：`FEATURE_STATE_PROJECTION_BROADCAST`（**默认关** ⇒ 零行为变更）。**测试**：`tests/execution/executionProjection.test.ts` **5 例** · `tests/execution/projectionBroadcast.test.ts` **4 例**；`lint:arch` **0 错**（R09-006 候选 **53 不变**）· `typecheck` 三工程全绿 · `lint:fn-size`/`lint:complexity` 未增长 · `bun test tests/state tests/chat tests/session tests/channels tests/query tests/execution` **1572 pass / 0 fail**。⚠️ **未接线（如实，UW）**：① **无生产消费者**（出站订阅面 = 通道治理 §3 阶段 2.3，已**暂缓**）⇒ 不宣称"已下发到通道"；② **`SUSPENDED` 无生产者**（预算挂起未实现）⇒ 当前**不可达**（阶段 5）；③ 其余域未投影（`toolCall` 无单一 choke point；`session`/`app`/`task` 无真实消费者）。`e2eVerified=false`。证据 `FSM-PROJECTION-P4`
- ⛔ **阶段 5 阻塞（取证，零产品代码改动）** - **前置不存在**：① 预算**挂起**能力缺失 —— `TAORLoop.beforeReasoning`（`query/TAORLoop.ts:1115-1124`）耗尽即 `stopReason='budget_exhausted'; stopped=true; return`（**静默中止**，仅补 `logExhaustionAbort` 应用日志、**不给用户出路**）；② 上游 spec `long-task-suspend-resume.md` 仍为**立项稿·未排期·未头脑风暴**，其 §5 明写「**在此之前不动任何产品代码**」；③ `SUSPENDED` 投影**无生产者**（已在阶段 4 用测试锁"当前不可达"）⇒ **按设计与上游裁定不可执行**，**不虚造挂起态、不伪造进度**（CS05/CS06）。**已具备的前置（未来接入可直接复用，避免重复造）**：relief 台账（`DailyBudgetManager` 的 `effectiveLimit`/`debtTokens`/`ReliefKind` + `POST|DELETE /v1/cost/daily-budget/relief` 与 `GET` 暴露 relief/debt）· 唤醒信号（后端 3 发送点经 `cost:dailyBudgetUpdated` 广播、前端 `useNotificationSSE` 已订阅 —— 即上游 spec §3-Q4 点名候选）。**5.3 现状澄清（避免重复实现）**：「富上下文错误帧 `DAILY_BUDGET_EXCEEDED` + 三种恢复路径**可交互**结算」**已由 `daily-budget-over-limit-ux` 落地**（SSE `__pyapp_error_code` + 非流式 `errorCode`/`errorContext`；前端 `DailyLimitNotice` 三路径卡片 → `usageService.setDailyBudgetRelief`；通道侧**专用文案**）⇒ 本方案**不再实现第二套**。⚠️ **唯一残留缺口（如实）**：**通道侧**为**文案**、**非可交互**（按钮/回调），属通道侧（需出站交互面 + 入站回调，落通道治理 阶段 2.3/2.4），**不属**本方案内核改造。证据 `FSM-SUSPENDED-P5`（`fixed:false` 阻塞条目）
- ⬜ **未做（如实）**：无（阶段 1–4 已完成；阶段 5 阻塞于上游 `long-task-suspend-resume.md`）

> 📚 **完整版本历史见 [CHANGELOG.md](./CHANGELOG.md)** —— 本处仅保留最新一版摘要（单一事实源：变更记录不在两处重复维护）。

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
