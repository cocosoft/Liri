---
description: 架构设计原则与实施规范。适用于架构设计、重构、架构治理、代码收敛、双轨制消除等任务。包含Harness驱动哲学、TAOR循环、测试先行（测试未通过不得提交）、架构收敛规范、文档目录维护等。
---

# 架构设计原则与实施规范 / Architecture & Implementation Rules

> 架构治理规则、设计原则、实施规范。
>
> Architecture governance, design principles, and implementation standards.

---

## 一、架构设计原则 / Architecture Design Principles

### 1.1 Harness 驱动哲学

把智能下沉到模型，把确定性留给框架。

### 1.2 TAOR 循环设计

Orchestrator 只负责驱动循环、执行工具、感知结果，推理决策交给模型。

### 1.3 工具设计哲学

- **核心工具(5个)**: Bash、Read、Write、Search、ToolSearch（始终加载）
- **MCP工具**: 默认延迟加载，模型发现时才加载

### 1.4 权限五档信任光谱

`plan`(只读) → `default`(询问) → `acceptEdits`(自动批准) → `dontAsk`(白名单) → `bypass`(跳过检查)

### 1.5 模型数据唯一源

- `ModelConfigs.ts` 是唯一数据源
- `ModelManager.ts` 提供统一查询 API
- 禁止硬编码模型 ID

### 1.6 后台守护进程设计原则

- **ProcessManager** 负责进程生命周期管理（启动、停止、重启、保活）
- **TaskQueue** 负责后台任务调度（提交、查询、取消、优先级）
- **IPC 通信层** 支持 Unix Socket 和 HTTP 两种传输协议
- 进程崩溃自动重启（不超过 5 次/分钟）
- 支持优雅关闭（≤ 30 秒超时）
- 后台任务必须支持取消（`AbortController`）
- 任务进度必须可查询（0-100%）
- 守护进程状态指标必须上报 `MonitoringService`
- 集成 Chronos 定时任务调度能力

### 1.7 测试先行原则（强制）

- 修复 bug 前先编写可重现该 bug 的测试用例
- 重构前确保已有测试通过，重构后补充新测试
- 每个新功能必须有对应的测试用例
- **测试未通过不得提交代码**：所有代码合入前，必须确保单元测试、功能测试、集成测试全部通过
- 每次提交前运行完整测试套件（`bun run test`），确保不引入回归缺陷

---

## 二、实施原则 / Implementation Principles

### 2.1 核心原则

1. 仅学习 CC、Hermes-Agent 和 OpenClaw 源码，不修改
2. 先设计后开发
3. 不删除现有代码，仅新增或修改

### 2.2 内置命令三要素

1. 独立文件/目录
2. 懒加载出口（`load()`）
3. UI组件配套（`.tsx`）— 每个工具必须包含配套的 UI 组件（进度条、状态显示、错误展示）
4. 必须包含测试用例

### 2.3 测试分层覆盖

| 层级  | 类型   | 覆盖率   |
| --- | ---- | ----- |
| 架构层 | 单元测试 | ≥ 80% |
| 功能层 | 功能测试 | ≥ 60% |
| 集成层 | 集成测试 | ≥ 40% |

### 2.4 设计原则

- 单一职责、依赖倒置、接口隔离、开闭原则

---

## 三、架构收敛规范 / Architecture Convergence

### 3.1 状态管理统一

- **`core/state/`** **为唯一状态管理层**，禁止使用其他状态管理实现
- 现有 `state/` 目录功能必须迁移到 `core/state/` 扩展
- 所有状态相关导入必须从 `@modules/core/state/` 引入
- 禁止新增 `Store` / `StateManager` 的独立实现

### 3.2 代码复用收敛

- 通用工具函数（`sleep`、`deepClone`、`deepMerge`、`formatDate` 等）必须集中在 `src/utils/common.ts`
- 禁止在各模块中重复实现相同功能的工具函数
- 发现重复代码立即整合到公共工具文件

### 3.3 类型定义收敛

- **`src/types/`** **目录为所有公共类型的唯一来源**
- 禁止在各模块中定义与 `src/types/` 重复的类型接口
- 子模块特有类型定义在本模块 `types/` 目录下，但不得与全局类型冲突

### 3.4 启动流程标准化

- 所有初始化必须通过 `ModuleInitializer` 统一调度，遵循依赖顺序
- 启动序列：环境检测 → 配置加载 → 模块系统初始化 → 强制功能初始化 → 可选功能初始化 → 启动完成回调

### 3.5 禁止在模块初始化序列之外直接调用核心组件的初始化方法

### 3.6 工具分区并发执行规范

- QueryEngine 执行工具调用时必须按只读/写入分区
- **只读工具**（Read、Search、List、View、Get 等）：同一分区内并发执行
- **写入工具**（Write、Edit、Bash、Create、Delete、Rename 等）：串行执行，严格按顺序
- 分区策略在 `QueryEngine.executeToolCalls()` 中统一实现
- 工具分类由工具定义的 `type` 或 `readonly` 属性决定

### 3.7 上下文压缩策略规范

- 必须实现三种压缩策略：
  - **autoCompact**：基于 Token 阈值（默认 80%）自动触发压缩
  - **reactiveCompact**：基于上下文增长率（连续 3 轮增长率 > 15%）触发压缩
  - **microcompact**：轻量压缩，仅移除低价值系统消息
- 压缩策略在 `compaction/` 中统一实现（2026-10-01 D-217 由 `services/compact/` 改归 app，现为独立模块 `@modules/compaction`）
- 所有压缩操作必须记录原始 Token 数和压缩后 Token 数

### 3.8 特征开关(FeatureFlag)规范

- `core/featureFlags.ts` 为特征开关的唯一数据源
- 禁止在 `constants/featureFlags.ts` 或其他位置重复定义特征开关
- 支持编译时 DCE（通过 Bun 的 `feature()` 函数），非核心功能可在编译期剪裁
- 特征开关命名规范：`feature_模块名_功能名`
- 新增特征开关必须同时添加运行时开关和编译时开关

### 3.9 安全模块整合规范

- `security/` 为安全功能的唯一实现目录
- `tools/security/`、`chat/security/`、`bridge/security/` 仅引用不实现
- 所有安全分析逻辑收敛到 `security/` 下的统一模块
- 消除 `CompleteSecuritySystem.ts` 与 `BashSecurityAnalyzer.ts` 的功能重叠
- 安全审计接口统一由 `security/` 导出

### 3.10 缓存系统接口规范

- `cache/` 为缓存系统的核心目录，定义 `ICache` 接口
- `cost/cache/`、`mcp/utils/MCPCacheManager.ts`、`tools/cache/` 等子模块必须实现 `ICache` 接口
- 提供统一 `CacheManager` 工厂，按用途创建不同缓存实例
- 缓存 Key 命名规范：`模块名:子模块:具体键名`

### 3.11 实现唯一性原则（双轨制禁止）

- **严禁出现"双轨制"**：同一功能不允许存在两套及以上并行的实现
- 判定标准：同一功能域出现两套独立实现，其中一套为活跃使用、另一套为孤立/死代码，即构成双轨制
- 已识别并消除的双轨制案例：
  - MCP 模块：`mcp/`（增强层）与 `services/mcp/`（标准层）→ 按分层原则合并
  - State 管理：`state/` 与 `core/state/` → 已迁移到 `core/state/` 统一管理
  - 文件工具：`tools/filesystem/`（活跃）与 `tools/File*Tool/`（孤立）→ 已合并到独立目录
- 新增功能必须在唯一的实现目录内开发，禁止另起炉灶创建平行实现
- 发现双轨制须立即记录并按以下流程处理：
  1. 评估两套实现的差异（功能、接口、覆盖度）
  2. 确定保留目标和合并策略
  3. 将功能合并到目标实现中
  4. 删除冗余实现
  5. 更新所有引用路径

### 3.12 项目根目录解析规范（编译 exe 专用）

**背景**：Bun 编译的独立 exe 在 Windows 上运行时，`process.cwd()` 可能返回根路径（`\` 或 `D:\`），因为 Bun 会将 exe 解压到临时目录。此问题影响所有依赖 `process.cwd()` 获取项目路径的模块。

**解决方案**：双层入口架构 + OS 级 `chdir` 覆盖。

#### 3.12.1 双层入口架构

```
pyapp.ts（编译入口 — 启动引导层）
   │
   ├─ 1. determineProjectRoot() → 按优先级解析项目根目录
   ├─ 2. sanitizePath() → 清洗引号/空白杂质
   ├─ 3. process.chdir(projectRoot) → 修改 OS 级工作目录
   │
   └─ import('./main')  →  加载主程序（所有 process.cwd() 自动正确）
                           │
                           └─ launch() → 按模式分发
```

| 文件 | 角色 | 导入方式 |
|------|------|---------|
| `src/pyapp.ts` | **编译入口**（`bun build --compile` 目标） | `await import('./main')` |
| `src/main.ts` | **模块入口**（运行时入口） | `import { launch } from './main'` |

#### 3.12.2 项目根目录解析优先级链

```
 1. --project-dir 命令行参数         （最可靠，启动脚本传递）
 2. PYAPP_PROJECT_DIR 环境变量       （启动脚本设置）
 3. process.argv[0] → exe 所在目录   （无启动脚本时自动推断）
    ├─ exe 在 dist/ 下 → 父目录为项目根
    └─ exe 在其他目录 → 该目录为项目根
 4. INIT_CWD 环境变量                 （npm/pnpm script 兜底）
 5. process.cwd()                     （最后手段，原样返回）
```

#### 3.12.3 路径获取原则

- **所有模块**通过 `process.cwd()` 获取项目根目录（已由 `pyapp.ts` 的 `chdir` 保证正确）
- **无需**也不应传递 `--project-dir` 或读取 `PYAPP_PROJECT_DIR` 环境变量——`chdir` 一次覆盖全局
- 路径工具函数 `resolveProjectRoot()`（`config/paths.ts`）作为 fallback 安全网保留

#### 3.12.4 启动脚本要求

- `.bat` / `.ps1` 启动脚本**必须**设置 `PYAPP_PROJECT_DIR` 环境变量和 `--project-dir` 参数
- 启动脚本应 `cd /d "%PROJECT_DIR%"` 切换到项目根目录
- `PROJECT_DIR` 必须去除尾部反斜杠，防止 Windows 参数解析器将 `\"` 误判为转义引号

> **核心约束**：禁止在 `pyapp.ts` 之外实现另一套根目录解析逻辑。新增启动方式必须通过 `pyapp.ts` 的优先级链，不得绕过。

### 3.13 通道体系架构收敛（2026-06-16 完成）

**背景**：通道系统存在 `channels/`（新）与 `core/gateway/`（旧）双轨制，现已完成收敛。

#### 3.13.1 收敛成果

| 维度 | 收敛前 | 收敛后 |
|------|--------|--------|
| 通道注册 | ChannelManager + ChannelRegistry 双入口 | ChannelRegistry 唯一入口 |
| 消息路由 | 分散在各通道适配器 | routeChannelMessage() 统一管线 |
| 事件总线 | GatewayEventBus 独立 | ChannelEventBus + 桥接层 |
| 帧验证 | 各通道独立实现 | 统一 validateInboundFrame() |
| 去重 | 各通道独立 Set/Map | 统一 dedup/index.ts |
| 错误处理 | 分散 logger.error + tracker | 统一 handleError() 入口 |
| 接口实现 | WebChannel 双接口 (GatewayChannel + ChannelPlugin) | 仅 ChannelPlugin |

#### 3.13.2 遗留兼容层

`core/gateway/` 下的 `ChannelManager`、`GatewaySetup`、`GatewayTool` 保留为兼容层，仅做状态同步，已标记 `@deprecated`。新功能全部在 `channels/` 下开发。

#### 3.13.3 文件清单

| 新模块 (channels/) | 对应旧模块 (core/gateway/) | 状态 |
|-------------------|--------------------------|------|
| `channels/registry/ChannelRegistry.ts` | `core/gateway/ChannelManager.ts` | 新 → 兼容层 |
| `channels/routing/messageRouter.ts` | 分散在各通道适配器 | 统一 |
| `channels/events/ChannelEventBus.ts` | `core/gateway/events/GatewayEventBus.ts` | 新 → 兼容层 |
| `channels/dedup/index.ts` | 各通道自建去重 | 统一 |
| `channels/validation/` | 各通道自建帧验证 | 统一 |
| `channels/DevicePairingService.ts` | 无 | 新增 |

#### 3.13.4 启动时序（收敛后）

```
main.ts → launch()
  ├── 1. channelRegistry.initPersistence()       ← 加载 DB 持久化配置
  ├── 2. setupChannelsFromConfig()              ← 唯一注册入口
  │     └── ChannelBootstrapper.bootstrap()
  │           └── channelRegistry.register(adaptPluginToInterface(plugin))
  ├── 3. lazyConnectChannels()                  ← 延迟连接（后台异步）
  └── 4. [legacy] setupGatewayFromConfig()      ← 兼容层，仅做状态同步
```

---

### 3.14 观测层与业务判据边界（`traces/` 降级，2026-09-23）

**结论（Spec `trajectory-single-source-convergence.md` v0.2 裁决 D1）**：`trace-recording`
模块及其落盘目录 `~/.pyapp/data/traces/`（`trace_YYYY-MM-DD.jsonl`）是**观测层**，
**不可作为业务判据**。

- **唯一权威**：模型可见输入/用量一律以 `events.jsonl` 的事件为准
  （用量 = `metric/timing`；压缩区间 = `context/compaction`）。
- **红线**：❌ 业务模块不得 `import` `trace-recording`（除观测/导出/查看层：`AppCoreOTelHelper`、
  `infrastructure/http/handlers/trace-handlers`、`commands/builtin/trace-recording`、
  `tools/TraceRecordingTool`）。token 校准的消费方是 `UnifiedTokenTracker.recordTimingUsage()`
  （数据源 = `metric/timing` 载荷），**不再订阅** `traceUsageListeners`。
- **保留/清理策略**：**唯一实现**是 `src/session/ArtifactRetention.ts`
  （`traceKeepDays = 7`，按 mtime 判龄，匹配 `trace_*.jsonl`；由 `SessionGateway.startPruneInterval`
  的 5 分钟节拍驱动）。`TraceWriter` **只轮换不删除** —— 新增第二套清理机制违反 §3.11 实现唯一性。
- **凭据处置**：落盘前剥离凭据 —— 敏感请求/响应头整值脱敏（`sanitizeHeaders`），
  URL 中的凭据查询参数脱敏（`sanitizeUrl`，如 `GoogleProvider` 的 `?key=`）。

---

## 四、文档目录维护规则 / Docs Directory Maintenance

### 4.1 文档结构规范

```
app/docs/
├── index.md              # 文档首页导航表
├── API.md                # API 参考
├── CORE_MODULES.md       # 核心模块说明
├── DEVELOPMENT.md        # 开发指南（含项目结构树）
├── SKILLS.md             # 技能系统
├── TOOLS.md              # 工具参考
├── USAGE.md              # 使用说明
├── 模块管理使用指南.md      # 模块管理
├── 模块开发规范.md          # 模块开发规范
├── 快速入门/              # 安装、配置、上手
├── 安装部署/              # 各平台安装
├── 渠道/                 # 消息渠道（每个渠道一个 .md + index.md 导航）
├── 概念与架构/             # 系统设计文档
├── 核心模块/              # 核心功能模块
├── 工具参考/              # 工具使用说明
├── 自动化/               # cron/webhook/tasks/hooks
├── 插件系统/              # 插件开发与使用
├── 配置与安全/             # 配置与安全策略
├── 开发指南/              # 二次开发指引
└── 帮助与支持/             # FAQ/故障排除
```

### 4.2 同步规则

1. **新增源码模块/子模块时**，须在 `app/docs/` 对应目录添加 `.md` 文档，并在 `index.md` 导航表中添加引用
2. **删除源码模块时**，同步清理 `app/docs/` 中对应的文档和导航引用
3. **修改模块接口或行为时**，同步更新 `app/docs/` 中对应文档
4. **`app/docs/index.md`** 的导航表必须与 `app/docs/` 目录结构保持一致，删除的文档引用须及时移除
5. **`DEVELOPMENT.md`** 中的项目结构树须与 `src/` 实际目录保持同步
6. **根级文档**（API/TOOLS/SKILLS/USAGE/CORE_MODULES/模块管理使用指南）内容须与源码对应

### 4.3 文件文档与代码集成

- `src/docs/FileDocsProvider.ts` 提供从 `app/docs/` 文件夹动态加载 Markdown 文档的能力
- 启动时自动加载 `app/docs/` 下所有 `.md` 文件到帮助系统，支持 `/help` 和 `/docs` 命令直接访问
- 当新增文档文件时，**无需修改代码**即可被 `/docs <标题>` 和 `/docs search <关键词>` 检索到
- 导航索引文件（各目录下的 `index.md`）是用户浏览的主要入口，新增文件时务必更新

### 4.4 模块 README.md 与 app/docs/ 的分工

| 维度 | 模块级 `README.md` | `app/docs/` 目录文档 |
|------|-------------------|--------------------------|
| 位置 | `模块名称/README.md` | `app/docs/核心模块/模块名.md` |
| 读者 | 开发者（二次开发、维护） | 最终用户 + AI 助手 |
| 内容 | API 签名、内部架构、设计决策、调试方法 | 使用说明、配置方法、示例、常见问题 |
| 加载方式 | 源码浏览时直接阅读 | `/docs` 命令动态加载到帮助系统 |
| 更新时机 | 每次修改代码同步更新 | 功能/接口对用户可见变化时更新 |
| 强制程度 | 必须（[development-workflow.md §1.6](file:///e:/PY/CODES/Liri/.trae/rules/development-workflow.md#L61-L68)） | 必须（[development-workflow.md §2.9](file:///e:/PY/CODES/Liri/.trae/rules/development-workflow.md#L132-L140)） |

> **简言之**：`README.md` 写给开发者看，"怎么实现的"；`app/docs/` 写给用户和 AI 看，"怎么使用的"。

---

## 五、特别说明 / Special Notes

### 5.1 KAIROS 替换

CC 源码中的 KAIROS 系统已被 Chronos 系统替换。

### 5.2 技术栈选型

| 层级    | 选型               |
| ----- | ---------------- |
| 编排层   | TypeScript + Bun |
| 性能核心  | Rust             |
| 终端 UI | React + Ink      |
| 校验层   | Zod v4           |
| 认证    | OAuth 2.0 / JWT  |
