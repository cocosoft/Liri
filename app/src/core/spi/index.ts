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

export { AppError, ErrorCategory, ErrorSeverity } from './ErrorTypes';

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

// 2026-10-06 U4（`.trae/specs/online-quality-evaluation.md` §D6）：会话在线质量端口
// （消除 chronos/autoDream 读 turn/quality 事件的 infra → app 倒挂，同 D-148 的 KnowledgeGraph 先例）
export {
  type ISessionQualityPort,
  type TurnQualitySummaryDto,
  SESSION_QUALITY_SERVICE_ID,
  registerSessionQualitySpi,
  resolveSessionQuality,
} from './SessionQualityService';

// 2026-10-07：协作编排统一层端口（**薄端口 / 预留**；`.trae/specs/collaboration-orchestration-port.md`）
export {
  type ICollaborationPort,
  type CollaborationDispatchRequestDto,
  type CollaborationDispatchResultDto,
  COLLABORATION_SERVICE_ID,
  registerCollaborationSpi,
  resolveCollaboration,
} from './CollaborationService';

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

// 2026-10-01 D-155：Hook 链端口（消除 cost 的 infra -> app 倒挂）
export {
  type IHookChainPort,
  type HookExecutePayload,
  type HookExecuteResult,
  HOOK_CHAIN_SERVICE_ID,
  registerHookChainSpi,
  resolveHookChain,
} from './HookChainService';

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
  type AiModelPricingDto,
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
// P1-7：SPI 装配顺序守卫（显式依赖 + 注册期断言；对应不变量 INV-ARCH-001）
export {
  SPI_WIRING_REQUIRES,
  isSpiRegistered,
  markSpiRegistered,
  requireSpiDependencies,
  resetSpiRegistryForTest,
} from './wiringGuard';
