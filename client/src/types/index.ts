/** 前端类型定义统一入口 — 从子模块 re-export，向后兼容 */

// ─── API 响应类型 ───
export type { ApiError, ApiResponse } from "./api";
export { isApiResponse, unwrapApiResponse } from "./api";

// ─── 核心业务类型 ───
export type { Session } from "./session";
export type {
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
  KnowledgeSource,
  KnowledgeBase,
  KnowledgeFile,
} from "./knowledge";

// ─── 智能体 ───
export type { AgentTask, AgentTaskTemplate, AgentProgress } from "./agent";

// ─── 调度 ───
export type { ScheduleConfig, ExecutionRecord, CronTask, ScheduleMode } from "./schedule";

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
export type { DreamLogEntry, DreamLogResponse } from "./dream";

// ─── 用户与权限 ───
export type { User, ApiKey, Permission } from "./user";

// ─── 监控 ───
export type { MetricPoint, Alert, LogEntry, LogSource, SystemHealth } from "./monitor";

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
export type { Config, BackendStatus } from "./config";