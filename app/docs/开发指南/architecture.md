# 项目架构

> Liri 目录结构、核心设计模式、启动流程。

---

## 完整目录树

```
app/src/                      应用源码（34 个顶层目录；已物理拆包者见下方 packages/）
├── main.ts                  入口 — launch() 多模式分发
├── pyapp.ts                 编译入口（chdir + 根目录解析）
├── healthcheck.ts           健康检查
├── monitor.ts               进程监控
│
├── entrypoints/             启动初始化 (init.ts / repl / cli / http-server / mcp / daemon)
├── bootstrap/               启动引导（preflight / 变体注入 / 启动流水线；entry 层外壳，不成包）
├── modules/                 模块系统（ModuleDefinitions / ModuleRegistry / 懒加载）
│
├── commands/                命令系统（builtin / registry / pipeline / executor）
├── tools/                   工具系统（BaseTool / policy / guardrails / environments / web）
├── ai/                      AI 模型与提供商（providers / clients / prompts / credentials / cost）
├── agent/                   Agent 引擎（strategies / swarm / moa / trajectory）
├── chat/                    对话 / 流式 / 工具循环
├── tasks/                   任务系统（目标 / 计划 / 编排 / 持久队列）
├── knowledge/               知识库 / 检索
├── context/                 上下文管理（context-engine 已迁出至 packages/）
├── acp/                     ACP 协议（core 层归属）
│
├── infrastructure/          HTTP 服务层（LocalHTTPService + handlers + 路由子域）
├── runtime/                 运行时 API（CoreAPI / Inbox / 通知持久化）
├── plugins/                 插件系统
├── hooks/                   钩子链 + React hooks（混合体，待拆分）
├── lsp/                     LSP 客户端
├── workspace/               工作空间域（.liri 目录 / 工作项生命周期）
├── appState/                应用级状态容器
│
├── ui/ components/ ink/ cli/ vim/ keybindings/    终端 UI 与交互
├── types/                   共享类型定义
├── auto-reply/ flows/ promptSuggestion/           自动回复 / 工作流 / 提示建议
├── remote/ subagents/ testing/ scripts/ wizard/   远程接入 / 子代理事件泵 / 测试辅助 / 内部脚本 / 配置向导
└── （层归属逐一以 scripts/modules-to-layers.json 为准）

packages/                     物理独立包（23 个，各含 package.json + tsconfig.json；说明符仍为 @modules/<module>）
├── kernel/                  core 层：内核桶 @openliri/kernel
├── infra/                   infra 层：config / error / monitoring / utils / system(含 state) / security …
├── service/                 service 层：session / execution / runtime / voice / bridge / streaming / ports …
├── channels/                service 层：通道系统（唯一实现层）
├── query/                   app 层：查询引擎 (TAOR) + verifyProject
├── skills/                  app 层：技能系统（三来源归一化）
├── sandbox/                 app 层：沙箱执行（Landlock / 平台适配）
├── compaction/              app 层：会话级压缩
├── tokenBudget/             app 层：Token 预算 / 定价 / 上下文窗口
├── vfs/                     app 层：AI-VFS（挂载 + 驱动契约）
├── docs/                    app 层：文档帮助
├── plugin-sdk/              app 层：插件 SDK
├── workspaces/              app 层：工作区注册 / 扫描 / 清理 / Git
├── governance/              app 层：治理模块
├── dream/                   app 层：梦境模块
├── evals/                   app 层：Agent 评测框架
├── proactive/               app 层：主动式智能体
├── project/                 app 层：项目域
├── subagent/                app 层：子代理管理
├── resourceGovernor/        app 层：跨会话资源治理
├── tool/                    app 层：工具结果 / 作用域注册
├── context-engine/          app 层：上下文引擎
└── buddy/                   app 层：虚拟伙伴
```

> **层序**：`entry > ui > app > service > infra > core`（唯一事实源 `scripts/modules-to-layers.json`）。
> **包边界门禁**：`bun run lint:infra`（R1–R28，逐包 `lint:<pkg>` 由 `lint:gate-parity` 校验覆盖）。
> **迁移状态**：`app/src` 仍有 34 个顶层目录，迁包是**逐模块**进行、未迁者留在原地的中间态，不是双实现。

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
  ├── REPL 模式 → init.ts → 模块并行初始化（ModuleRegistry.bootstrap）→ 命令注册 → 交互式 REPL
  ├── CLI 模式 → 单次查询 → exit
  ├── MCP 模式 → MCP Server 启动
  └── DAEMON 模式 → 守护进程
```

> 易漂移数字（工具数 / 通道数 / 模块数）不在此处硬写，见仓库根 `STATUS.md`（由 `bun run gen:status` 从事实源现算，`lint:status` 门禁校验）。

---

## 环境变量

| 变量 | 说明 |
|------|------|
| `ANTHROPIC_API_KEY` | Anthropic API 密钥 |
| `OPENAI_API_KEY` | OpenAI API 密钥 |
| `GOOGLE_API_KEY` | Google Gemini API 密钥 |
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥 |
| `REDACT_ENABLED` | 运行时日志脱敏开关 |
| `Liri_WRITE_SAFE_ROOT` | 文件写入安全根目录 |
