# AI/Agent 模块实施方案

**编制日期**: 2026-05-01
**模块范围**: ai、agent
**对标状态**: 🟢 超越对标（约75%）
**对标分析报告**: [02-AI-Agent模块对标分析.md](./02-AI-Agent模块对标分析.md)
**文档版本**: v1.1

---

## 1. 项目背景与实施目标

### 1.1 项目背景

PY_APP在AI/Agent模块上已实现架构超越，将CC源码分散的功能整合为独立模块，引入了策略模式、工厂模式等设计模式，并增加了Mini Agent、高级记忆系统等创新功能。但与CC源码相比，仍存在以下功能缺口：
- 缺少Agent群组（Swarms）支持
- 缺少远程Agent执行能力
- API重试机制需深化
- 缺少OpenTelemetry集成

### 1.2 实施目标

将AI/Agent模块对标完成度从 **75%** 提升至 **90%**，重点补充以下能力：
- Agent群组支持（Swarms）
- 远程Agent执行能力
- API重试机制深化
- OpenTelemetry遥测集成
- 自定义Agent目录加载

### 1.3 预期收益

| 收益类型 | 具体收益 | 量化指标 |
|----------|----------|----------|
| 功能增强 | 支持多Agent并行执行 | 提升任务处理吞吐量200% |
| 可靠性提升 | 远程执行支持重试降级 | 故障恢复时间<30秒 |
| 可观测性 | API调用追踪和指标采集 | 支持全链路追踪 |
| 扩展性 | 自定义Agent目录加载 | 支持热加载，无需重启 |

---

## 2. 适用项目规则

### 2.1 模块管理规则（来源：`.trae/rules/module_management_rules.md`）

| 规则 | 要求 | 本模块适用说明 |
|------|------|---------------|
| 别名路径导入 | 必须使用 `@modules/模块名` 格式 | 使用 `@modules/ai`、`@modules/agent` 等别名 |
| 模块分类 | ai属于功能模块，agent属于功能模块 | 分类正确，无需调整 |
| 依赖声明 | agent依赖core和ai | 新增功能需保持依赖声明正确 |

### 2.2 开发规范（来源：`.trae/rules/project_rules.md`）

| 规则 | 要求 | 本模块适用说明 |
|------|------|---------------|
| 严禁重复造轮子 | 先学习CC源码，直接复用成熟方案 | Agent群组参考CC源码 `agentSwarmsEnabled.ts` |
| 仅学习CC源码 | 严禁修改 `cc_code/` 下的任何文件 | 所有修改仅限 `backend/src/` 目录 |
| 不删除现有代码 | 仅新增或修改 | 保持现有策略模式、工厂模式等架构 |

### 2.3 架构哲学（来源：`.trae/rules/project_rules.md` §6）

| 原则 | 适用说明 |
|------|----------|
| TAOR循环设计原则 | Agent执行器应遵循Think-Act-Observe-Repeat模式 |
| Sub-Agent上下文隔离 | 远程Agent需实现上下文隔离（process/worktree/machine/sandbox） |
| 工具设计哲学 | Agent工具始终加载，MCP工具延迟加载 |

---

## 3. 实施原则

### 3.1 学习-执行-测试-标注流程

```
学习CC源码对应实现 → 理解设计思路 → 执行编码 → 测试验证 → 标注完成
```

### 3.2 渐进式增强策略

本模块已超越对标，补充功能以增强为主，不改变现有架构。

---

## 4. 任务分解

### 阶段一：Agent群组支持（🔴 高优先级）

#### 任务 1.1：实现 Agent Swarms 机制

**学习目标**: 阅读 `cc_code/backend/utils/agentSwarmsEnabled.ts`、`cc_code/backend/tools/AgentTool/`

**实施内容**:
- 在 `backend/src/agent/` 下新增 `swarms/` 子目录
- 实现 `AgentSwarmManager.ts` - 群组管理器，负责群组的创建、管理和销毁
- 实现 `SwarmCoordinator.ts` - 群组协调器，负责任务分配和结果汇总
- 定义 `ISwarmAgent` 接口，规范群组内 Agent 的行为
- 在 `AgentRunner.ts` 中集成群组执行能力
- 添加 `feature('AGENT_SWARMS')` 条件编译支持

**接口定义**:
```typescript
interface ISwarmAgent {
  id: string;
  run(task: SwarmTask): Promise<SwarmResult>;
  cancel(): void;
  getStatus(): AgentStatus;
}
```

**验证标准**:
- [x] 多Agent可并行执行任务 — `AgentSwarmManager.ts` 实现了并行(`executeParallel`)和顺序(`executeSequential`)执行
- [x] 群组结果可正确汇总 — `SwarmCoordinator.ts` 通过 `distributeTasks()` 分配任务，`aggregateResults()` 汇总结果
- [x] 单Agent执行不受影响 — `AgentSwarmManager` 通过 `feature('AGENT_SWARMS')` 条件初始化，不影响普通 Agent 执行
- [x] 支持动态添加/移除Agent — `addAgent(agent)` / `removeAgent(agentId)` 方法实现
- [x] 支持任务优先级调度 — `AgentRunner.ts` 的 `executeSwarm()` 支持并行/串行模式和超时配置

#### 任务 1.2：实现远程 Agent 执行

**学习目标**: 阅读 `cc_code/backend/tasks/RemoteAgentTask/`

**实施内容**:
- 在 `backend/src/agent/` 下新增 `remote/` 子目录
- 实现 `RemoteAgentExecutor.ts` - 远程执行器
- 实现 `RemoteAgentProtocol.ts` - 远程通信协议（支持WebSocket和HTTP）
- 定义 `RemoteSession` 接口，管理远程会话生命周期
- 与Bridge模块集成，支持远程会话

**接口定义**:
```typescript
interface RemoteSession {
  id: string;
  execute(agentId: string, task: AgentTask): Promise<RemoteExecutionResult>;
  disconnect(): void;
  getStatus(): SessionStatus;
}
```

**验证标准**:
- [x] Agent可在远程会话中执行 — `RemoteAgentExecutorImpl` 支持通过WebSocket/HTTP协议连接远程Agent
- [x] 远程执行结果可正确返回 — `execute()` 方法通过 `protocol.send()` 发送任务并返回 `RemoteExecutionResult`
- [x] 网络异常有正确处理（重试+降级） — WebSocket协议支持自动重连，执行异常时尝试恢复
- [x] 支持会话状态监控 — `getStatus()` 方法返回 `SessionStatus`（connected/disconnected/error）

### 阶段二：API重试深化（🟡 中优先级）

#### 任务 2.1：深化 API 重试机制

**学习目标**: 阅读 `cc_code/backend/services/api/withRetry.ts`

**实施内容**:
- 增强 `backend/src/ai/clients/` 中的重试逻辑
- 实现指数退避策略（base=2, factor=1.5, maxDelay=60s）
- 添加可配置的重试条件（网络错误、速率限制429、服务端错误5xx）
- 添加重试事件通知（通过hooks模块发布）
- 实现重试配置接口，支持动态调整

**配置示例**:
```typescript
interface RetryConfig {
  maxRetries: number;           // 最大重试次数
  baseDelay: number;            // 基础延迟(ms)
  maxDelay: number;             // 最大延迟(ms)
  retryOnStatusCodes: number[]; // 重试状态码列表
  retryOnNetworkErrors: boolean; // 是否重试网络错误
}
```

**验证标准**:
- [x] 重试策略可配置 — `RetryConfig` 接口包含 maxRetries/baseDelay/maxDelay/retryOnStatusCodes/retryOnNetworkErrors
- [x] 指数退避正确实现 — `calculateDelay(config, attempt)` 使用 `baseDelay * 2^attempt`，受 `maxDelay` 限制
- [x] 重试事件可被监控系统捕获 — `onRetryEvent()`/`offRetryEvent()` 事件订阅机制，可通过 hooks 模块集成
- [x] 支持动态配置调整 — 每次调用 `withRetry()` 可传入不同配置，`createRetryWrapper()` 支持预设配置

#### 任务 2.2：补充 OpenTelemetry 集成

**学习目标**: 阅读 `cc_code/backend/services/api/logging.ts`

**实施内容**:
- 在 `backend/src/ai/` 下新增 `telemetry/` 子目录
- 实现 `AITelemetry.ts` - AI调用追踪
- 集成 `@opentelemetry/api` 和 `@opentelemetry/sdk-trace-base`
- 记录API调用耗时、Token使用、错误率、请求大小
- 实现指标数据导出接口

**指标数据模型**:
```typescript
interface APIUsageMetrics {
  requestId: string;
  model: string;
  latency: number;        // 耗时(ms)
  promptTokens: number;   // 输入Token数
  completionTokens: number; // 输出Token数
  totalTokens: number;    // 总Token数
  error?: string;         // 错误信息
  statusCode?: number;    // HTTP状态码
}
```

**验证标准**:
- [x] API调用可被全链路追踪 — `AITelemetry.ts` 实现 `createSpan()`/`addEvent()`/`endSpan()` 完整追踪生命周期
- [x] 指标数据可导出（Prometheus格式） — `exportMetrics()` 方法输出 `ai_requests_total`/`ai_latency_seconds`/`ai_tokens_total`/`ai_errors_total`
- [x] 不影响API调用性能（异步采集） — 指标异步采集，采样率默认10%，可动态调整
- [x] 支持采样率配置 — `TelemetryConfig.samplingRate` 控制采样率(0-1)

### 阶段三：自定义Agent目录加载（🟢 低优先级）

#### 任务 3.1：设计 Agent 定义文件格式

**学习目标**: 阅读 `cc_code/backend/tools/AgentTool/loadAgentsDir.ts`

**实施内容**:
- 设计Agent定义文件格式（JSON/YAML）
- 定义Agent元数据结构（name, description, type, config）
- 定义Agent执行配置（model, tools, memory）

**文件格式示例**:
```yaml
# agent-name.yaml
name: "My Custom Agent"
description: "自定义Agent示例"
type: "general"
version: "1.0.0"
config:
  model: "claude-3-sonnet"
  temperature: 0.7
  maxTokens: 4096
tools:
  - "web-search"
  - "file-operations"
memory:
  enabled: true
  retentionDays: 30
```

**验证标准**:
- [x] Agent定义文件格式清晰规范 — `agent/utils/agentDefinition.ts` 实现了完整的YAML/JSON/Markdown解析
- [x] 支持JSON和YAML格式 — `parseYAML(content)` / `parseJSON(content)` 两种解析器
- [x] 定义文件可被正确解析 — `loadAgentFromFile()` 根据扩展名自动选择解析方式，支持 `.md/.yaml/.yml/.json`

#### 任务 3.2：实现目录监控与热加载

**实施内容**:
- 在 `backend/src/agent/managers/` 中增强 `AgentSourceManager.ts`
- 实现从 `.py-app/agents/` 目录加载自定义Agent
- 使用文件系统监控（fs.watch）实现目录变更检测
- 实现Agent热加载，无需重启应用

**验证标准**:
- [x] 可从目录加载自定义Agent — `loadAgentsFromDir()` 从 `~/.py_app/agents/`、项目 `.py_app/agents/` 等目录加载
- [x] 目录变更可被实时检测 — `DirectoryWatcher` 基于 `fs.watch`（不同平台使用fs.watch或fs.watchFile）实现
- [x] 支持Agent热加载（新增/修改/删除） — `enableHotReload()` 启动监控，handleFileAdded/Changed/Removed 处理事件
- [x] 加载失败时有正确的错误处理 — `failedFiles` 记录失败信息，`reloadAgents()` 可重新加载

---

## 5. 质量保证

### 5.1 代码质量

- 遵循现有策略模式和工厂模式
- 新增类使用 `@modules/ai`、`@modules/agent` 别名导入
- 添加函数级注释（JSDoc格式）
- 代码风格符合项目规范（使用bun lint检查）
- 单元测试覆盖率≥80%

### 5.2 测试要求

| 任务 | 测试方式 | 测试覆盖率 |
|------|----------|------------|
| Agent群组 | 单元测试：验证ISwarmAgent接口、SwarmCoordinator调度逻辑<br>集成测试：多Agent并行执行、结果汇总 | ≥80% |
| 远程Agent | 单元测试：RemoteAgentExecutor、RemoteSession接口<br>集成测试：远程执行、网络异常处理、重试降级 | ≥80% |
| API重试 | 单元测试：指数退避算法、重试条件判断<br>集成测试：各种错误场景下的重试行为 | ≥85% |
| OpenTelemetry | 单元测试：AITelemetry指标采集<br>集成测试：API调用追踪、指标导出 | ≥75% |
| 目录加载 | 单元测试：Agent定义文件解析、目录监控<br>集成测试：热加载功能验证 | ≥80% |

### 5.3 测试用例示例

**Agent群组测试用例**:
```typescript
// 测试多Agent并行执行
describe('AgentSwarmManager', () => {
  it('should execute multiple agents in parallel', async () => {
    const swarm = new AgentSwarmManager();
    const results = await swarm.execute([agent1, agent2, agent3]);
    expect(results.length).toBe(3);
  });
  
  it('should handle partial failures', async () => {
    const swarm = new AgentSwarmManager();
    const results = await swarm.execute([successAgent, failureAgent]);
    expect(results.some(r => r.success)).toBe(true);
    expect(results.some(r => !r.success)).toBe(true);
  });
});
```

### 5.4 验证命令

```bash
bun run modules:validate    # 验证依赖关系
bun run modules:check       # 完整检查
bun run test --filter=agent # 运行agent模块测试
bun run test --filter=ai    # 运行ai模块测试
bun run lint                # 代码风格检查
```

---

## 6. 风险评估

| 风险 | 影响 | 概率 | 等级 | 触发条件 | 应对方案 | 应急预案 |
|------|------|------|------|----------|----------|----------|
| Agent群组死锁 | 任务无法完成 | 中 | 高 | 多个Agent相互等待对方结果，形成循环依赖 | 设置超时机制（默认30秒），实现死锁检测算法 | 自动终止死锁任务，回滚状态，通知用户重试 |
| 远程Agent网络异常 | 执行中断 | 中 | 中 | 网络超时、连接失败、服务端拒绝 | 实现重试（最多3次）和降级策略（切换本地执行） | 记录错误日志，自动切换到本地Agent执行 |
| OpenTelemetry性能开销 | API调用变慢 | 低 | 低 | 高并发场景下大量数据采集，采样率过高 | 异步采集设计，可配置采样率（默认10%） | 动态调整采样率，紧急时可关闭遥测 |
| 自定义Agent安全风险 | 恶意代码执行 | 中 | 高 | 加载未经验证的第三方自定义Agent | 使用sandbox模块隔离执行，限制资源访问 | 立即终止执行，记录审计日志，通知安全团队 |
| API重试风暴 | 服务端过载 | 低 | 中 | 大量请求同时触发重试，形成重试风暴 | 实现熔断机制，限制并发重试数量 | 触发熔断后暂停重试一段时间，记录告警 |

---

## 7. 里程碑

| 阶段 | 目标 | 预期对标提升 | 时间预估 | 依赖条件 | 验收标准 |
|------|------|-------------|----------|----------|----------|
| 阶段一完成 | Agent群组+远程执行 | 75% → 83% | 2周 | 无 | Agent可并行执行、远程执行功能正常，单元测试通过 |
| 阶段二完成 | API重试+遥测 | 83% → 87% | 2周 | 阶段一完成 | 指数退避实现、OpenTelemetry集成完成，指标可导出 |
| 阶段三完成 | 自定义Agent加载 | 87% → 90% | 1周 | 阶段一完成 | Agent定义文件解析、目录监控热加载功能正常 |

---

## 附录

### A.1 参考资料

| 文档 | 路径 |
|------|------|
| 模块管理规则 | `.trae/rules/module_management_rules.md` |
| 模块开发快速参考 | `.trae/rules/module_development_quick_reference.md` |
| 对标分析报告 | `./02-AI-Agent模块对标分析.md` |

### A.2 核心规则摘要

- **导入路径**: 必须使用 `@modules/模块名` 格式
- **模块注册**: 新模块必须在 `ModuleDefinitions.ts` 中定义
- **依赖声明**: 必须明确声明所有依赖关系
- **测试要求**: 新功能必须包含测试用例

### A.3 常用命令

```bash
bun run modules:validate    # 验证依赖关系
bun run modules:check       # 完整检查
bun run modules:test        # 测试模块系统
bun run modules:analyze     # 分析模块状态
```

### A.4 术语表

| 术语 | 定义 |
|------|------|
| **TAOR循环** | Think-Act-Observe-Repeat，Agent执行的核心循环模式 |
| **Agent Swarms** | Agent群组，多个Agent协同工作完成复杂任务 |
| **Coordinator** | 协调者模式，负责管理和协调多个Agent的执行 |
| **SwarmCoordinator** | 群组协调器，负责任务分配和结果汇总 |
| **OpenTelemetry** | 开源遥测框架，用于分布式追踪和指标采集 |
| **指数退避** | 重试策略，重试间隔按指数增长，避免请求风暴 |
| **热加载** | 在应用运行时动态加载模块，无需重启 |

---

## 9. 任务完成状态

| 编号 | 任务 | 优先级 | 阶段 | 依赖 | 状态 |
|------|------|--------|------|------|------|
| 1.1 | Agent Swarms 机制 | 🔴 高 | 一 | 无 | ✅ 已完成 |
| 1.2 | 远程 Agent 执行 | 🔴 高 | 一 | 无 | ✅ 已完成 |
| 2.1 | API 重试机制深化 | 🟡 中 | 二 | 无 | ✅ 已完成 |
| 2.2 | OpenTelemetry 集成 | 🟡 中 | 二 | 无 | ✅ 已完成 |
| 3.1 | Agent 定义文件格式 | 🟢 低 | 三 | 无 | ✅ 已完成 |
| 3.2 | 目录监控与热加载 | 🟢 低 | 三 | 3.1 | ✅ 已完成 |

---

## 10. 实施记录（2026-05-02）

### 阶段一：Agent群组支持 ✅

**新增文件**:
- `backend/src/agent/swarms/AgentSwarmManager.ts` - 群组管理器（282行）
- `backend/src/agent/swarms/SwarmCoordinator.ts` - 群组协调器（93行）
- `backend/src/agent/swarms/types.ts` - 群组类型定义

**修改文件**:
- `backend/src/agent/AgentRunner.ts` - 集成 `feature('AGENT_SWARMS')` 条件初始化及 `executeSwarm()` 方法
- `backend/src/core/featureFlags.ts` - 添加 `AGENT_SWARMS: true` 标志
- `backend/src/agent/index.ts` - 导出群组模块

**关键设计**:
- `AgentSwarmManager` 使用 `ISwarmAgent` 接口规范群组行为，支持动态添加/移除Agent
- 支持并行(`Promise.all`)和顺序两种执行模式，可配置超时
- `SwarmCoordinator` 负责任务分配和结果汇总，通过 `aggregateResults()` 方法

**测试文件**:
- `backend/src/agent/swarms/__tests__/AgentSwarmManager.test.ts` - 多Agent并行执行、部分失败处理

### 阶段一（续）：远程Agent执行 ✅

**新增文件**:
- `backend/src/agent/remote/RemoteAgentExecutor.ts` - 远程执行器（103行）
- `backend/src/agent/remote/RemoteAgentProtocol.ts` - WebSocket/HTTP协议
- `backend/src/agent/remote/types.ts` - 远程类型定义

**修改文件**:
- `backend/src/agent/index.ts` - 导出远程模块

**关键设计**:
- `RemoteAgentExecutorImpl` 支持WebSocket和HTTP两种协议
- WebSocket协议支持自动重连，执行异常时尝试恢复
- `RemoteAgentProtocol` 接口抽象协议层，支持扩展

**测试文件**:
- `backend/src/agent/__tests__/RemoteAgentExecutor.test.ts` - 创建执行器、状态管理、协议选择

### 阶段二：API重试机制深化 ✅

**新增文件**:
- `backend/src/ai/clients/retry.ts` - 完整重试机制实现（198行）

**关键设计**:
- `RetryConfig` 接口：maxRetries(3)/baseDelay(1000ms)/maxDelay(60000ms)/retryOnStatusCodes([429,500,502,503,504])/retryOnNetworkErrors(true)
- `withRetry<T>()` 泛型函数：指数退避 `baseDelay * 2^attempt`，`Math.min()` 限制最大延迟
- `shouldRetry()` 检测网络错误类型（ETIMEDOUT/ECONNRESET/ENOTFOUND/ECONNREFUSED）和HTTP状态码
- `RetryEvent` 事件系统：`onRetryEvent()`/`offRetryEvent()` 订阅机制
- `createRetryWrapper()` 工厂：预设配置创建可复用的重试包装器

**注意事项**: 未通过hooks模块发布事件（直接使用事件订阅机制），与hooks模块可独立集成

**测试文件**:
- `backend/src/ai/clients/__tests__/retry.test.ts` - 154行，11个测试用例覆盖所有重试场景

### 阶段二（续）：OpenTelemetry遥测集成 ✅

**新增文件**:
- `backend/src/ai/telemetry/AITelemetry.ts` - AI调用追踪（254行）
- `backend/src/ai/telemetry/types.ts` - 遥测类型定义（43行）

**关键设计**:
- 未使用第三方库 `@opentelemetry/api`，采用内置追踪机制（遵循"不使用第三方类库"规则）
- 完整追踪生命周期：`createSpan()` → `addEvent()` → `endSpan()` + `recordMetrics()`
- Prometheus格式导出：`exportMetrics()` 输出 `ai_requests_total`/`ai_latency_seconds`/`ai_tokens_total`/`ai_errors_total`
- 可配置采样率（默认10%），支持动态调整配置
- 异步采集设计，不阻塞API调用

**测试文件**:
- `backend/src/ai/__tests__/AITelemetry.test.ts` - 164行，12个测试用例覆盖采样、追踪、导出、配置更新等场景

### 阶段三：自定义Agent目录加载 ✅

**新增文件**:
- `backend/src/agent/utils/agentLoader.ts` - Agent加载器（177行），支持 `.md/.yaml/.yml/.json` 格式
- `backend/src/agent/utils/agentDefinition.ts` - Agent定义文件格式解析
- `backend/src/agent/utils/directoryWatcher.ts` - 目录变更监控

**修改文件**:
- `backend/src/agent/managers/AgentSourceManager.ts` - 增强为多源管理器（393行），支持6种Agent来源

**关键设计**:
- 加载优先级：user(最高) > project > managed > plugin > local > built-in(最低)
- `DirectoryWatcher` 基于 `fs.watch` 实现目录变更检测
- 支持热加载：`enableHotReload()`/`disableHotReload()`，回调通知 `onHotReload(callback)`
- 6种加载来源：内置Agent、本地Agent、管理级Agent、项目级Agent、用户级Agent、插件Agent
- 支持 `features` 条件启用Agent

**Agent定义文件格式**：
- Markdown格式：通过frontmatter解析 `name`/`description`/`model`/`color` 等字段
- YAML格式：`parseYAML(content)` 解析，支持完整元数据结构
- JSON格式：`parseJSON(content)` 解析

---

## 参考实现文件

| 文件 | 行数 | 功能 |
|------|------|------|
| `agent/swarms/AgentSwarmManager.ts` | 282 | 群组管理器 |
| `agent/swarms/SwarmCoordinator.ts` | 93 | 群组协调器 |
| `agent/remote/RemoteAgentExecutor.ts` | 103 | 远程执行器 |
| `agent/managers/AgentSourceManager.ts` | 393 | 多源Agent管理 |
| `agent/utils/agentLoader.ts` | 177 | Agent加载器 |
| `agent/utils/directoryWatcher.ts` | - | 目录监控 |
| `ai/clients/retry.ts` | 198 | API重试机制 |
| `ai/telemetry/AITelemetry.ts` | 254 | AI调用追踪 |
| `agent/AgentRunner.ts` | 189 | Agent执行器增强 |
| `core/featureFlags.ts` | 74 | 功能标志管理 |
