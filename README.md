<div align="center">

<img src="app/assets/logo.png" alt="Liri Logo" width="120" />

# Liri · OpenLiri

> 玲珑鸟 · 你的 AI 私人助手
> 官网：https://openliri.com

**终端里的 AI 智能体 · 连接 26 个平台的智能助手**

一键安装 · 自然语言交互 · 81 个内置工具 · 企业级安全

[![CI Status](https://github.com/cocosoft/Liri/actions/workflows/ci.yml/badge.svg)](https://github.com/cocosoft/Liri/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![Version](https://img.shields.io/badge/version-0.4.73-blue)

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

Agent 引擎内置 4 种检查点机制（CheckpointManager），长时间运行的任务可落盘续跑；工具调用轮次、压缩、截断等关键节点均写事件日志，支持回放与审计。

### 🛠 内置工具（81 个）

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
- **协作编排** — 议事（`CouncilOrchestrator`）、蜂群（`SwarmCoordinator`）、链式（`AgentChain`）多种编排形态；构造点收敛为**模块内单例**，避免同一编排器多处 `new` 导致状态分叉
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
│   │   ├── tools/               # 81 个内置工具实现
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

当前版本：**v0.4.73**

版本管理遵循 [语义化版本规范](.trae/rules/versioning.md)：
- 修订号 — 按需升，每次发版 +1（Bug 修复、文档更新、小重构）
- 次版本 — 每月/每迭代 +1，修订号归零（新增功能、新通道接入、架构重构）
- 主版本 — 达到 v1.0.0 标准时一次性从 0.x.x 跳到 1.0.0

### 🚀 版本更新记录

#### v0.4.73 (2026-10-10)

**第九轮外部审查落地（专项 A 五缺陷 + §七 安全基线 + 专项 B 执行生命周期 B-01–B-05 及跨层改造）+ Rust SWC CallExpression 扫描器（FFI 贯通）+ 默认关开关触发条件治理**

- ✅ **专项 A（Bash/AST 安全，5 缺陷全修）** - 原生解析器**从未加载**（`lazyInitNative` 哨兵恒假，已修 + 可观测）· TS 解析器不识别 `\|\|` ⇒ 命令**绕过**（已修）· 审批 hash 抹掉**引号语义**（改引号感知状态机、保留大小写）· AST 不确定时**不失败关闭**（转人工审批）· 调用方 `env` 可**覆盖**已剥离敏感项（新增 `sanitizeCallerEnv()`）
- ✅ **§七 安全开关基线** - `BASH_APPROVED_REVALIDATE` **默认 `false` → `true`（安全基线）**（关闭时已批准命令**跳过整套硬拦截**）；R07-2 全链同步（含 `SAFETY_SWITCHES` 保 `def:true` **防静默翻回**）；`BASH_INTERPRETER_GUARD` / `BASH_APPROVAL_STRICT` 维持灰度 + 启用/回滚条件/迁移期限 + 一次性告警
- ✅ **专项 B（执行生命周期）** - **B-01** 恢复后可能并存**双 `RUNNING`**（`foreignActive` 外部占用；不盲目 `owner.set()`，STALE 时解除）· **B-02** 恢复两步间崩溃 ⇒ 工具调用永久 `running`（**倒序**：先标 `unknown` 再置 `STALE`）· **B-03** `MAX(seq)+1` 并发竞争（串行化 + 唯一索引兜底）· **B-04** `QUEUED` 取消恒失败（按状态分流直接 `CANCELLED`）· **B-05** 记账 fire-and-forget（可等待 `beginToolCall()`）
- ✅ **B-05 跨层改造** - `executionId` 经 `ChatRequest` → `StreamMessageOptions` → `ChatManager` 下传至**工具执行者** ⇒ 执行前 `await beginToolCall()`，落盘失败即**拒绝该工具**（**逐工具** fail-closed）；记账收敛为**单一写入方**
- ✅ **Rust SWC CallExpression 扫描器** - 新 `js_ast.rs`（SWC 遍历 `CallExpr`/`NewExpr` + 特征表）+ FFI `py_scan_js_calls` + `CodeRunner` 校验链第 5 步（不可用 ⇒ 降级跳过）；**识别** `globalThis['eval']` 混淆；`cargo test` **101 pass**
- ✅ **触发条件治理 + 清理** - O1–O5 观测点（零行为变更）· 新建默认关开关登记表（单一事实源）+ CI **登记完整性断言**（23 ⇒ 34）· 删除零消费预留端口 · PDCA 启动扫描不再静默跳过 · Ch.16 / Ch.21 落 spec + 裁定
- ✅ **质量** - `typecheck` **0** · `tests/{execution,channels,chat}` **755 pass** · `tests/{tools,security,permission}` **788 pass** · `lint:arch` 违规 **0** · `lint:doc-code` ✅
- ⚠️ **未完成（如实登记）** - 跨层安全回归测试（AST/TS/审批/spawn **决策一致性**）与**沙箱执行**测试组未做；故障注入仅覆盖调用顺序；**专项 C 8 项测试清单未做**（其 C-01/C-02/C-03 与 B-03/B-02/B-05 同源、已修）

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
