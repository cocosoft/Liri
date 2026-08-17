/** 前端类型定义统一入口 — 从子模块 re-export,向后兼容 */

// ─── API 响应类型 ───
export type { ApiError, ApiResponse } from "./system";
export { isApiResponse, unwrapApiResponse } from "./system";

// ─── 核心业务类型 ───
export type { Session } from "./session";
export type {
  AttachedImage,
  Message,
  MessageBlock,
  QuestionOption,
  QuestionData,
  ToolCall,
  TaskCardData,
  TaskCardTask,
  ProgressData,
  DeliverableData,
  DiffData,
  InboxBlockData,
  Tool,
} from "./message";

// ─── 模型与供应商 ───
export type {
  ModelInfo,
  ProviderInfo,
  ProviderFormData,
  ProviderPreset,
  ProviderCategory,
  EndpointLatency,
  CurrentModelInfo,
  TaskModelConfig,
  TaskDefinition,
  FetchedModel,
  BillingMode,
  TimeBasedPrice,
} from "./model";

// ─── 文件管理 ───
export type {
  FileEntry,
  WorkspaceInfo,
  StoreZone,
  FileSource,
  FileCategory,
  FilePreview,
  FileRegistryRecord,
  FileSearchParams,
  FileSearchResult,
  FileStats,
} from "./file";

// ─── 知识库 ───
export type {
  KnowledgeItem,
  KnowledgeSearchResult,
  KnowledgeSearchHit,
  KnowledgeSource,
  KnowledgeBase,
  KnowledgeFile,
  KnowledgeSortBy,
} from "./knowledge";

// ─── FAQ ───
export type { FAQEntry, FAQImportReport } from "./knowledge";

// ─── 知识库配置 ───
export type {
  KnowledgeSearchConfig,
  VectorStoreConfig,
  KnowledgeConfigData,
} from "./knowledge";

// ─── 知识图谱 / 调度 ───
export type { GraphEdge, GraphStats, GraphEdgesResponse } from "./project";
export type {
  ScheduleConfig,
  ExecutionRecord,
  CronTask,
  ScheduleMode,
} from "./project";

// ─── 智能体 ───
export type { AgentTask, AgentTaskTemplate, AgentProgress } from "./identity";

// ─── 伙伴系统 ───
export type {
  BuddySpecies,
  BuddyRarity,
  BuddyStat,
  BuddyEye,
  BuddyHat,
  BuddyCompanion,
  BuddyInteractionResult,
} from "./buddy";

// ─── 渠道 ───
export type {
  ChannelType,
  Channel,
  ChannelFormData,
  UpdateChannelRequest,
  ChannelHealth,
  ChannelHealthAggregate,
  ChannelMetricEntry,
  ChannelMetricsResponse,
  PlatformFieldDef,
  ChannelSchema,
  ChannelPluginInfo,
} from "./channel";

// ─── 梦境日志 ───
export type {
  DreamLogEntry,
  DreamLogResponse,
  DreamCycleSummary,
  DreamCycleListResponse,
  DreamCycleDetail,
  DreamCycleDetailResponse,
} from "./dream";

// ─── 用户与权限 ───
export type { User, ApiKey, Permission } from "./identity";

// ─── 监控 ───
export type {
  MetricPoint,
  Alert,
  LogEntry,
  LogSource,
  SystemHealth,
} from "./system";

// ─── 用量与余额 ───
export type {
  UsageSummary,
  DailyUsageStats,
  ModelUsageStats,
  ProviderUsageStats,
  BalanceResult,
  BalanceRecord,
} from "./usage";

// ─── 配置 ───
export type { BackendStatus } from "../api/types/config";

// ─── 工作模块类型 ─
export type {
  // 旧类型（@deprecated）
  Project,
  ProjectNode,
  ProjectNodeType,
  ProjectPriority,
  ProjectStatus,
  ProjectViewMode,
  // 统一任务模型（Phase A 新增）
  TaskType,
  TaskStatus,
  TaskPriority,
  TaskNode,
  ProjectV2,
  TaskStatusFilter,
  TaskViewMode,
} from "./work";
export { TASK_PRIORITY_LABELS } from "./work";

// ─── 编排时间线 ───
export type {
  TimelineEvent,
  TimelineEventType,
  SSETimelineEvent,
  OrchestrationHistoryResponse,
  CouncilStartData,
  CouncilEndData,
  CouncilAgentSpeakingData,
  CouncilRoundData,
  DagTaskStartData,
  DagTaskProgressData,
  DagTaskEndData,
  SwarmDispatchData,
  SwarmAgentStatusData,
  ChainStartData,
  ChainStepData,
  PlanStepStartData,
  PlanStepCompletedData,
  AgentThinkingStartData,
  AgentThinkingDeltaData,
  AgentThinkingEndData,
  AgentToolCallStartData,
  AgentToolCallEndData,
} from "./orchestration";
