# Liri — OpenLiri

> 玲珑鸟 · 你的 AI 私人助手
> 官网:https://openliri.com

AI Agent 后端服务,基于 **TypeScript + Bun + Rust** 架构,提供交互式命令行智能助手。

拥有 40+ 模块化子系统、4 阶段分层启动、三级延迟加载策略、多智能体通信协议(ACP),以及完整的安全沙箱与可观测性体系。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| **运行时** | Bun(主要)/ Node.js |
| **语言** | TypeScript (95%) + Rust (5%) |
| **终端 UI** | React + Ink |
| **AI 接口** | DeepSeek API(默认),支持多 Provider 切换(OpenAI、Gemini 等) |
| **协议层** | ACP(Agent Communication Protocol)+ MCP + LSP |
| **安全** | AST 级命令分析、细粒度权限控制、安全审计、Docker 沙箱 |
| **可观测性** | OpenTelemetry(Tracing + Metrics)、结构化日志、告警体系 |
| **存储** | SQLite + FTS5 全文搜索、文件系统持久化、缓存层 |
| **原生模块** | Rust(Bash AST 解析、安全分析、压缩) |

---

## 快速开始

```bash
# 安装依赖
bun install

# 配置 API 密钥
cp .env.example .env
# 编辑 .env,填入 DEEPSEEK_API_KEY

# 开发模式启动(带热重载)
bun run dev

# 生产模式
bun run start
```

首次启动将自动进入 **Onboard 引导**,引导你配置 API 密钥和基础设置。

---

## 启动架构

应用采用 **四阶段(T0-T3)分层启动**,确保核心功能快速就绪,重型模块延迟加载:

```
T0 ── 并行预读取(MDM/Keychain,不阻塞)
 │
T1 ── 模块系统初始化(仅 CRITICAL 模块)
 │
T2 ── 模式分发(REPL/CLI/MCP/Daemon)
 │
T3 ── 后台延迟加载(DEFERRED + ON_DEMAND 模块)
```

模块按优先级分三级:
- **CRITICAL** — 启动时必需加载(core、ai、config、error、performance 等)
- **DEFERRED** — 启动完成后按批次加载(chat、session、tools 等)
- **ON_DEMAND** — 首次按需动态 import(security、sandbox、mcp、voice 等)

---

## 项目结构

```
src/
├── main.ts                     # 应用启动入口(launch 函数)
├── entrypoints/                # 运行模式入口
│   ├── cli.tsx                 # CLI 模式
│   ├── init.ts                 # 环境初始化(T0-T3 启动流程)
│   ├── repl.ts                 # REPL 模式
│   └── mcp.ts                  # MCP Server 模式
│
├── modules/                    # 模块系统(注册表 + 初始化 + 延迟加载策略)
│   ├── ModuleRegistry.ts       # 模块注册表(DI 容器集成)
│   ├── ModuleDefinitions.ts    # 40+ 模块定义
│   ├── ModuleInitializer.ts    # 模块初始化器
│   └── LazyModuleStrategy.ts   # 三级延迟加载策略
│
├── core/                       # 核心基础设施
│   ├── gateway/                # 消息网关(ChannelManager + 多平台适配)
│   ├── session/                # 会话管理 + 监管器
│   ├── storage/                # 存储抽象层
│   ├── permission/             # 权限控制
│   ├── extensibility/          # 可扩展性服务
│   ├── approval/               # 审批流
│   ├── events/                 # 事件总线
│   ├── lifecycle/              # 生命周期管理
│   ├── flows/                  # 流程引擎
│   ├── hooks/                  # 钩子系统
│   ├── context/                # 上下文引擎
│   ├── cache/                  # 缓存抽象
│   ├── notification/           # 通知系统
│   └── tokenBudget/            # Token 预算控制
│
├── acp/                        # Agent Communication Protocol
│   ├── control-plane/          # 控制平面(会话管理、运行时控制)
│   ├── runtime/                # 运行时层
│   └── persistent-bindings/    # 持久化绑定
│
├── ai/                         # AI 模型适配层
│   ├── providers/              # 多 Provider(DeepSeek、OpenAI、Gemini 等)
│   ├── models/                 # 模型目录
│   ├── cost/                   # 成本追踪
│   ├── catalog/                # 模型能力目录
│   ├── policy/                 # AI 策略
│   ├── telemetry/              # AI 遥测
│   ├── failover/               # 故障切换
│   └── middleware/             # 中间件链
│
├── agent/                      # AI Agent 核心
│
├── tools/                      # 工具系统(随启动变体动态注册)
│   ├── bash/                   # Bash 执行
│   ├── web/                    # Web 搜索/抓取
│   ├── lsp/                    # LSP 工具
│   ├── permissions/            # 工具权限
│   ├── guardrails/             # 工具护栏
│   ├── policy/                 # 工具策略
│   ├── security/               # 工具安全
│   ├── executor/               # 工具执行器
│   └── orchestrator/           # 工具编排
│
├── sandbox/                    # 沙箱环境
│   ├── docker/                 # Docker 容器隔离
│   ├── managers/               # 沙箱管理器
│   └── utils/                  # 路径限制、超时控制、危险命令检查
│
├── memory/                     # 记忆与知识库
│   ├── services/               # Embedding、知识库写入、统一搜索
│   ├── stores/                 # 记忆存储
│   ├── retrievers/             # 记忆检索
│   ├── scanners/               # 记忆扫描
│   ├── consolidation/          # 记忆合并
│   ├── indexer/                # 记忆索引
│   └── priority/               # 记忆优先级
│
├── security/                   # 安全模块
│   ├── audit/                  # 安全审计
│   ├── bash/                   # Bash 安全分析
│   ├── injection/              # 注入检测
│   ├── scanner/                # 安全扫描
│   ├── validation/             # 安全验证
│   ├── redact/                 # 敏感信息脱敏
│   └── permission/             # 权限策略
│
├── monitoring/                 # 可观测性
│   ├── logs/                   # 结构化日志(含诊断、过滤、脱敏)
│   ├── metrics/                # 指标服务
│   ├── tracing/                # 会话追踪
│   ├── alerts/                 # 告警规则(含预设)
│   ├── incidents/              # 事件管理
│   ├── health/                 # 健康检查
│   ├── backup/                 # 备份管理
│   ├── archival/               # 数据归档
│   ├── dashboard/              # 仪表盘数据
│   └── otel/                   # OpenTelemetry 集成
│
├── channels/                   # 消息渠道(30+ 平台)
│   ├── discord/                # Discord
│   ├── slack/                  # Slack
│   ├── telegram/               # Telegram
│   ├── qq/                     # QQ
│   ├── wechat/                 # 微信
│   ├── dingtalk/               # 钉钉
│   ├── feishu/                 # 飞书
│   ├── email/                  # 邮件
│   ├── irc/                    # IRC
│   ├── nostr/                  # Nostr
│   ├── signal/                 # Signal
│   ├── sms/                    # SMS
│   ├── whatsapp/               # WhatsApp
│   ├── msteams/                # Microsoft Teams
│   ├── line/                   # LINE
│   ├── twitter/                # Twitter/X
│   ├── webhook/                # Webhook
│   └── ...                     # 更多
│
├── cli/                        # 命令行界面
├── commands/                   # 斜杠命令注册
├── chat/                       # 聊天会话管理
├── session/                    # 会话持久化
├── chronos/                    # 定时任务调度
├── cost/                       # API 调用成本追踪
├── config/                     # 配置管理
├── context/                    # 上下文引擎
├── bootstrap/                  # 启动引导
├── bridge/                     # 远程桥接控制
├── buddy/                      # AI 伙伴系统
├── cache/                      # 缓存模块
├── converter/                  # 格式转换
├── daemon/                     # 守护进程
├── docs/                       # 内置文档系统
├── enterprise/                 # 企业版功能
├── error/                      # 错误处理基础设施
├── featureflags/               # 功能开关(GrowthBook)
├── flows/                      # 流程引擎
├── governance/                 # 治理模块
├── hooks/                      # 钩子系统
├── ink/                        # 终端 UI(React + Ink)
├── insights/                   # 洞察分析
├── keybindings/                # 快捷键绑定(含 Vim 模式)
├── lsp/                        # LSP 客户端
├── mcp/                        # MCP 协议实现
├── media/                      # 媒体处理(图片/视频/音频)
├── models/                     # 模型类型定义
├── notebooks/                  # 笔记本
├── oauth/                      # OAuth 2.0 认证
├── performance/                # 性能追踪
├── plugin-sdk/                 # 插件 SDK
├── plugins/                    # 插件管理
├── query/                      # 查询引擎
├── remote/                     # 远程连接(SSH)
├── runtime/                    # API 运行时
├── services/                   # 业务服务
├── skills/                     # 技能系统
├── state/                      # 状态管理
├── streaming/                  # 流式处理
├── subagent/                   # 子代理系统
├── task/                       # 任务引擎
├── tasks/                      # 任务实现
├── types/                      # 全局类型定义
├── ui/                         # UI 组件
├── utils/                      # 工具函数
├── vim/                        # Vim 模式
├── voice/                      # 实时语音交互(WebSocket + Gemini Live)
├── wizard/                     # 配置向导
│
├── healthcheck.ts              # 健康检查
├── index.ts                    # 历史入口(已弃用 → 使用 main.ts)
├── main.ts                     # 主入口
└── monitor.ts                  # 系统监控
```

---

## 运行模式

| 模式 | 启动方式 | 说明 |
|------|----------|------|
| **REPL** | `bun run dev` / `bun run start` | 交互式命令行,默认模式 |
| **CLI** | 通过 `launch()` 参数指定 | 一次性命令执行 |
| **MCP Server** | `bun run src/entrypoints/mcp.ts` | MCP 协议服务器 |
| **Daemon** | 通过 `launch()` 参数指定 | 后台守护进程 |

---

## 命令系统

应用使用 `/` 开头的斜杠命令体系,在 REPL 模式下直接输入交互。

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

---

## 原生模块

`native/` 目录包含 Rust 编写的性能关键模块:

```bash
# 构建 Rust 原生模块
bun run native:build

# 调试构建
bun run native:build:debug

# 运行原生测试
bun run native:test
```

原生模块提供:
- **Bash AST 解析** — 命令结构分析
- **安全分析** — 命令安全检测
- **上下文管理** — 系统上下文收集
- **压缩** — 数据压缩

> 原生模块不可用时自动降级为 TypeScript 实现。

---

## 构建变体

```bash
bun run build:core        # 核心版
bun run build:personal    # 个人版
bun run build:coding      # 编程版
bun run build:enterprise  # 企业版
bun run build:dry-run     # 构建预览(不实际构建)
```

---

## 开发命令

```bash
bun run dev               # 开发模式(热重载)
bun run typecheck         # 类型检查
bun run lint              # 代码检查
bun run lint:fix          # 自动修复
bun run format            # 格式化代码
bun test                  # 运行测试
bun run test:coverage     # 测试覆盖率
bun run health            # 健康检查
bun run monitor           # 系统监控
```

---

## 服务部署

支持将 Liri 后端安装为系统自启服务，开机自动运行、崩溃自动重启。

```bash
# 1. 编译为独立二进制
bun run build:win        # Windows
bun run build:mac        # macOS
bun run build:linux      # Linux

# 2. 安装为系统服务
bun run service:install

# 3. 查看服务状态
bun run service:status
```

| 平台 | 底层机制 | 安装方式 | 开机自启 |
|------|---------|---------|---------|
| **Windows** | `schtasks` 任务计划程序 | `bun run service:install` | ✅ |
| **macOS** | `launchd` LaunchAgent | `bun run service:install` | ✅ |
| **Linux** | `systemd` service | `bun run service:install` | ✅ |

> 开发测试可用 `bun run service:dev`（无需编译，直接 `bun run` 启动）。

详细文档：[守护进程模块](src/daemon/README.md)

---

## 文档

完整文档位于 `docs/` 目录,建议新用户从 [📖 用户引导](docs/用户引导/guide.md) 开始。

---

## 核心优势

### 强大的 Agent 引擎

基于 **TAOR（Think-Act-Observe-Reason）循环**的 Agent 架构，支持自主规划-执行-观察的闭环决策。内置 4 种检查点机制，确保长时间运行任务的可靠性。支持 DeepSeek、OpenAI、Anthropic Claude、Ollama 等多种模型。

### 内置工具集（随启动变体动态注册）

覆盖文件操作、命令执行、网络能力、媒体处理、编程辅助、Agent 协作、任务管理等场景。三层工具架构（定义 → 权限 → 沙箱），每工具均可独立授权审计；具体工具数量以运行时注册为准（`GET /v1/tools`），不写死宣传数字。

### 5 层安全防护

从 **Rust AST 编译时分析**到 **Docker 沙箱隔离**的纵深防御体系：40+ 命令语义模式库、细粒度权限控制、完整审计日志、速率限制与风险追踪。

### 30+ 消息渠道

Discord、Slack、Telegram、QQ、微信、钉钉、飞书、邮件、IRC、Signal 等主流平台全覆盖，统一协议帧和路由管理。

### 企业级可观测性

指标采集、链路追踪、告警规则、健康检查、备份归档、仪表盘，全链路 OpenTelemetry 标准集成。

### Tauri 桌面客户端

跨平台原生桌面应用（Tauri v2 + React），支持全局快捷键、系统托盘、自动更新。

### 4 种构建变体

**核心版** / **个人版** / **编程版** / **企业版**，按需选择。

### 插件与技能系统

标准 SDK + 插件市场，技能系统支持条件触发与自动编排。

---

## 致谢

感谢我人生中遇到的每一个人——家人、朋友、同事、同学。

你们的陪伴、启发、支持和包容,塑造了今天的我和这个项目。每一行代码背后,都有你们留下的痕迹。

谢谢你们。

---

## 许可证

MIT
