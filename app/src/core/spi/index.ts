/**
 * core/spi/ — SPI 接口统一出口
 *
 * SPI（Service Provider Interface）是 core 层定义的抽象契约，
 * 由上层（infra/app/service）实现后通过 DI 容器注入。
 *
 * 使用 SPI 的核心原则：
 * 1. core 层只定义接口，不引用任何上层实现
 * 2. 上层实现注册到 DI 容器，core 层通过容器获取
 * 3. 所有 SPI 接口集中在 core/spi/ 目录中统一管理
 */

export {
  type ILogger,
  type ILoggerService,
  LogLevel as SpiLogLevel,
  LOGGER_SERVICE_ID,
  registerLoggerSpi,
  resolveLogger,
} from './LoggerService';

export {
  type IOTelService,
  type IOTelTracing,
  OTEL_SERVICE_ID,
  registerOTelSpi,
  resolveOTelTracing,
} from './OTelService';

export {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  ERROR_SERVICE_ID,
} from './ErrorTypes';

export { TtlCache } from './CacheService';

export {
  type IStartupProfilerPort,
  STARTUP_PROFILER_SERVICE_ID,
  registerStartupProfilerSpi,
  resolveStartupProfiler,
} from './ProfilerService';

export {
  type IBroadcastService,
  BROADCAST_SERVICE_ID,
  registerBroadcastSpi,
  resolveBroadcast,
} from './BroadcastService';

// 2026-10-01 D-144：Agent 执行端口（消除 Coordinator 的 core → app 倒挂）
export {
  type IAgentToolPort,
  AGENT_TOOL_SERVICE_ID,
  registerAgentToolSpi,
  resolveAgentTool,
} from './AgentToolService';

// 2026-10-01 D-147：任务注册表端口（消除 chronos / daemon 的 infra → app 倒挂，9 处）
export {
  type ITaskRegistryPort,
  type LightweightTaskKind,
  type TaskRegistryStatus,
  TASK_REGISTRY_SERVICE_ID,
  registerTaskRegistrySpi,
  resolveTaskRegistry,
} from './TaskRegistryService';

// 2026-10-01 D-148：知识图谱端口（消除 chronos/autoDream 的 infra → app 倒挂，3 处）
export {
  type IKnowledgeGraphPort,
  type KnowledgeDomainDto,
  KNOWLEDGE_GRAPH_SERVICE_ID,
  registerKnowledgeGraphSpi,
  resolveKnowledgeGraph,
} from './KnowledgeGraphService';

// 2026-10-01 D-154：沙箱端口（消除 security 的 infra -> app 倒挂）
export {
  type ISandboxPort,
  SANDBOX_SERVICE_ID,
  registerSandboxSpi,
  resolveSandbox,
} from './SandboxService';

export {
  type LoadedPluginBriefDto,
  type IPluginSystemService,
  PLUGIN_SYSTEM_SERVICE_ID,
  registerPluginSystemSpi,
  resolvePluginSystem,
} from './PluginSystemService';

export {
  type DiagnosticsProvidersSnapshotDto,
  type DiagnosticsMcpSnapshotDto,
  type IDiagnosticsProbeService,
  DIAGNOSTICS_PROBE_SERVICE_ID,
  registerDiagnosticsProbeSpi,
  resolveDiagnosticsProbe,
} from './DiagnosticsProbeService';

export {
  type AiProviderBriefDto,
  type BalanceProbeResultDto,
  type AiRoleChatResultDto,
  type IAiAccessService,
  AI_ACCESS_SERVICE_ID,
  registerAiAccessSpi,
  resolveAiAccess,
} from './AiAccessService';

export {
  type KnowledgeCompileOptionsDto,
  type KnowledgeCompileResultDto,
  type KnowledgeLintIssueDto,
  type KnowledgeLintResultDto,
  type IKnowledgeService,
  KNOWLEDGE_SERVICE_ID,
  registerKnowledgeSpi,
  resolveKnowledge,
} from './KnowledgeService';
