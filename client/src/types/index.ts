/** 前端类型定义统一入口 — 从子模块 re-export,向后兼容 */

// ─── API 响应类型 ───
export type { ApiError, ApiResponse } from "./api";
export { isApiResponse, unwrapApiResponse } from "./api";

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
} from "./knowledge";

// ─── FAQ ───
export type { FAQEntry, FAQImportReport } from "./faq";

// ─── 知识图谱 ───
export type { GraphEdge, GraphStats, GraphEdgesResponse } from "./graph";

// ─── 智能体 ───
export type { AgentTask, AgentTaskTemplate, AgentProgress } from "./agent";

// ─── 调度 ───
export type {
  ScheduleConfig,
  ExecutionRecord,
  CronTask,
  ScheduleMode,
} from "./schedule";

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
export type { User, ApiKey, Permission } from "./user";

// ─── 监控 ───
export type {
  MetricPoint,
  Alert,
  LogEntry,
  LogSource,
  SystemHealth,
} from "./monitor";

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
  Project,
  ProjectNode,
  ProjectNodeType,
  ProjectPriority,
  ProjectStatus,
  WorkItemFilter,
  ProjectViewMode,
} from "./work";

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
