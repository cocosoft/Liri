# 项目架构

> PY_APP 目录结构、核心设计模式、启动流程。

---

## 完整目录树

```
backend/src/
├── main.ts                 入口 — launch() 多模式分发
├── entrypoints/            启动初始化 (init.ts/repl/cli/server/mcp/daemon)
│
├── core/                   核心基础设施
│   ├── api/                CoreAPI 统一 API 入口
│   ├── acp/                ACP 协议 (Agent Communication Protocol)
│   ├── gateway/            网关系统 — 多平台消息路由
│   ├── container/          DI 容器 + 模块依赖管理
│   ├── lifecycle/          优雅重启
│   ├── health/             依赖健康检查
│   └── streaming/          流式处理 (Stream/SSE/背压/擦洗)
│
├── ai/                     AI 模型与提供商
│   ├── providers/          9 个 AI 提供商
│   ├── clients/            ThinkingConfig/PromptCacheConfig/FallbackProvider
│   ├── prompts/            系统提示构建器 (PlatformHints/ModelGuidance/注入检测)
│   ├── credentials/        凭证池 (CredentialPool/CredentialHealth)
│   ├── cost/               成本 12 子系统
│   └── models/             模型元数据 (AIModelManager/别名系统)
│
├── agent/                  代理引擎
│   ├── agent.ts            AIAgentImpl 核心代理
│   ├── strategies/         策略工厂 + 多策略
│   ├── swarm/              Swarm 多代理编排
│   ├── router/             AgentRouter 智能路由
│   ├── moa/                MoA 混合代理
│   ├── trajectory/         执行轨迹记录
│   └── btw/                代理间通信
│
├── channels/               多渠道接入
│   ├── platforms/          10+ 平台适配器
│   ├── registry/           ChannelRegistry + ChannelInterface
│   └── session/            ChannelSessionManager
│
├── commands/               命令系统
│   ├── builtin/            20+ 内置命令
│   ├── registry/           EnhancedCommandRegistry
│   ├── pipeline/           命令管道
│   └── executor/           命令执行器
│
├── tools/                  工具系统
│   ├── BaseTool.ts         泛型抽象基类
│   ├── policy/             工具策略管道
│   ├── guardrails/         工具调用护栏
│   ├── environments/       执行环境 (Local/Docker)
│   └── web/                Web 工具
│
├── skills/                 技能系统
│   ├── SkillManager.ts     技能生命周期管理
│   ├── SkillCurator.ts     7 天间隔策展
│   ├── SkillHub.ts         集中式技能仓库
│   └── SkillConditionMatcher.ts YAML front matter 条件匹配
│
├── security/               安全体系 (6 大子系统)
│   ├── BashSecurityAnalyzer.ts Rust+TS 双引擎
│   ├── redact/             运行时日志脱敏
│   ├── files/              文件保护
│   ├── injection/          提示注入检测
│   ├── permission/         RBAC + DLP + OAuth
│   └── audit/              6 子系统审计
│
├── query/                  查询引擎
│   ├── QueryEngine.ts      7 状态查询状态机
│   ├── context/            上下文引擎
│   └── chat/               对话管理
│
├── storage/                SQLite 存储 (FTS5 全文搜索)
├── mcp/                    MCP 协议 (5 种传输层)
├── lsp/                    LSP 客户端
├── monitoring/             OpenTelemetry 遥测
└── session/                会话管理 (多后端存储)
```

---

## 核心设计模式

### AIProvider 接口

所有 AI 提供商实现同一接口：

```typescript
export interface AIProvider {
  readonly id: string;
  readonly displayName: string;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;
  chatStream(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<string, ChatResponse, unknown>;
  listModels(): Promise<string[]>;
  validateConfig(config: ProviderConfig): ProviderValidationResult;
}
```

### BaseTool 泛型基类

所有工具继承 `BaseTool<Input, Output, ProgressData>` — 编译时类型安全。

### ChannelInterface

所有平台适配器实现 `ChannelInterface` — 统一的消息收发契约。

### AgentStrategy

代理策略通过 `StrategyFactory` 创建，支持运行时切换不同的执行策略。

---

## 启动流程

```
main.ts → launch(mode)
  ├── REPL 模式 → init.ts → 40 模块并行初始化 → 111 命令加载 → 交互式 REPL
  ├── CLI 模式 → 单次查询 → exit
  ├── MCP 模式 → MCP Server 启动
  └── DAEMON 模式 → 守护进程
```

---

## 环境变量

| 变量 | 说明 |
|------|------|
| `ANTHROPIC_API_KEY` | Anthropic API 密钥 |
| `OPENAI_API_KEY` | OpenAI API 密钥 |
| `GOOGLE_API_KEY` | Google Gemini API 密钥 |
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥 |
| `REDACT_ENABLED` | 运行时日志脱敏开关 |
| `PY_APP_WRITE_SAFE_ROOT` | 文件写入安全根目录 |
