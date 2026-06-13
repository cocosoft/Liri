export interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  roundCount: number;
  agentId?: string;
  source?: string;
  tokenUsage?: {
    totalInput: number;
    totalOutput: number;
  };
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: number;
  session_id: string;
  tool_calls?: ToolCall[];
  blocks?: MessageBlock[];
  toolCallId?: string;
  /** LLM 返回的错误信息（用于显示重试/继续按钮） */
  error?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  };
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionData {
  questionId: string;
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

export interface MessageBlock {
  id: string;
  type: "text" | "thinking" | "tool_call" | "status" | "task_decomposition" | "question" | "todo";
  content: string;
  toolCall?: ToolCall;
  status?: string;
  isStreaming?: boolean;
  toolCallId?: string;
  groupId?: string;
  taskCard?: TaskCardData;
  questionData?: QuestionData;
}

/** TaskCard 数据 — 从 TodoWriteTool 的 todo list 映射 */
export interface TaskCardData {
  title: string;
  tasks: TaskCardTask[];
  status: "planning" | "executing" | "done";
}

export interface TaskCardTask {
  id: string;
  name: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "blocked";
  dependsOn: string[];
  result?: string;
  durationMs?: number;
}

export interface Tool {
  name: string;
  description: string;
  enabled: boolean;
  read_only: boolean;
  destructive: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  status?: "running" | "completed" | "failed";
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  providerId?: string;
  type: "chat" | "embedding" | "image";
  context_length: number;
  enabled: boolean;
  requiresAuth?: boolean;
  pricing?: {
    inputPer1M?: number;
    outputPer1M?: number;
    cacheReadPer1M?: number;
    cacheWritePer1M?: number;
  };
}

/** 供应商分类 */
export type ProviderCategory = 'official' | 'aggregator' | 'third_party' | 'cn_official';

/** 提供商配置（DB 驱动，对齐后端 ProviderRecord） */
export interface ProviderInfo {
  id: string;
  name: string;
  providerType: string;
  baseUrl: string;
  apiKey?: string;
  modelsUrl?: string;
  isActive: boolean;
  sortIndex: number;
  requiresAuth: boolean;
  notes?: string;
  icon?: string;
  iconColor?: string;
  category?: ProviderCategory;
  createdAt: number;
  updatedAt: number;
}

/** 提供商创建/编辑表单 */
export interface ProviderFormData {
  name: string;
  providerType: string;
  baseUrl: string;
  apiKey: string;
  modelsUrl: string;
  notes: string;
  requiresAuth: boolean;
  icon?: string;
  iconColor?: string;
  category?: ProviderCategory;
}

/** 供应商预设 */
export interface ProviderPreset {
  name: string;
  websiteUrl?: string;
  apiKeyUrl?: string;
  settingsConfig: ProviderFormData;
  isOfficial: boolean;
  category: ProviderCategory;
  apiFormat: 'openai' | 'anthropic' | 'google' | 'custom';
  providerType: string;
  requiresOAuth: boolean;
  modelsUrl?: string;
  endpointCandidates?: string[];
  theme?: {
    icon: string;
    backgroundColor: string;
    textColor: string;
  };
}

/** 端点测速结果 */
export interface EndpointLatency {
  url: string;
  latency?: number;
  status?: number;
  error?: string;
}

/** 余额查询结果 */
export interface BalanceResult {
  success: boolean;
  provider: string;
  data: Array<{
    planName?: string;
    remaining?: number;
    total?: number;
    used?: number;
    unit?: string;
  }>;
  error?: string;
}

/** 批量余额记录（来自 GET /v1/balances） */
export interface BalanceRecord {
  providerId: string;
  providerName: string;
  providerType: string;
  remaining: number | null;
  total: number | null;
  unit: string;
  queriedAt: number | null;
  supported: boolean;
  belowThreshold: boolean;
}

/** 使用量概览 */
export interface UsageSummary {
  totalRequests: number;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  successRate: number;
}

/** 每日趋势 */
export interface DailyUsageStats {
  date: string;
  requestCount: number;
  totalCost: number;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

/** 模型使用统计 */
export interface ModelUsageStats {
  model: string;
  requestCount: number;
  totalTokens: number;
  totalCost: number;
  avgLatencyMs: number;
}

/** 供应商使用统计 */
export interface ProviderUsageStats {
  providerId: string;
  providerName: string;
  requestCount: number;
  totalTokens: number;
  totalCost: number;
  successRate: number;
  avgLatencyMs: number;
}

/** 获取的模型信息 */
export interface FetchedModel {
  id: string;
  ownedBy?: string;
}

export interface Config {
  [key: string]: unknown;
}

export interface BackendStatus {
  running: boolean;
  port: number | null;
  pid?: number | null;
}

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  modified_at?: number;
  /** FileRegistry 唯一标识 */
  fileId?: string;
  /** 文件 MD5 */
  md5?: string;
  /** 来源枚举 */
  source?: FileSource | string;
  /** 存储分区 */
  storeZone?: StoreZone | string;
  /** MIME 类型 */
  mimeType?: string;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
}

export type StoreZone = 'inbound' | 'media' | 'artifact' | 'notebook';

export type FileSource =
  | 'upload'
  | 'channel_telegram' | 'channel_feishu' | 'channel_dingtalk'
  | 'channel_wecom' | 'channel_wechat' | 'channel_qq'
  | 'channel_discord' | 'channel_slack' | 'channel_line'
  | 'channel_irc' | 'channel_nostr' | 'channel_email'
  | 'channel_sms' | 'channel_webhook' | 'channel_googlechat'
  | 'channel_msteams' | 'channel_zalo' | 'channel_yuanbao'
  | 'channel_whatsapp' | 'channel_signal' | 'channel_matrix'
  | 'channel_facebook' | 'channel_twitter' | 'channel_claude'
  | 'channel_mattermost' | 'channel_bluebubbles'
  | 'tool_write' | 'tool_download' | 'tool_generate'
  | 'auto_ingest' | 'artifact' | 'notebook' | 'archive_extracted';

export type FileCategory = "output" | "downloads" | "attachments" | "knowledge" | "memory" | "inbound" | "media" | "artifact" | "notebook";

/** 当前模型状态（用于状态栏） */
export interface CurrentModelInfo {
  modelId: string;
  provider: string;
  routerTier?: string;
  routingMode?: 'dynamic' | 'static' | 'off';
  taskType: string;
  costThisSession: number;
  availableTasks: Array<{ type: string; label: string; icon: string }>;
}

/** 任务分工策略 */
export interface TaskModelConfig {
  chat?: string;
  coding?: string;
  translation?: string;
  quick?: string;
  agent?: string;
  scheduled?: string;
  local?: string;
  embedding?: string;
}

/** 任务定义（与后端 modelRouter.ts TaskDefinition 同步） */
export interface TaskDefinition {
  type: string;
  label: string;
  description: string;
  icon: string;
}

export interface KnowledgeItem {
  id: string;
  title: string;
  content: string;
  tags: string[];
  created_at: number;
  updated_at: number;
}

export interface KnowledgeSearchResult {
  id: string;
  title: string;
  content: string;
  category: string;
  score: number;
  matchType: string;
  docPath: string;
}

export type KnowledgeSource =
  | "manual"
  | "auto-memory"
  | "upload"
  | "chat-save"
  | "dream"
  | "compiled";

export interface KnowledgeBase {
  name: string;
  label: string;
  enabled: boolean;
  docCount: number;
  icon: string;
  createdAt: number;
  source: "system" | "user";
}

export interface KnowledgeFile {
  id: string;
  title: string;
  content: string;
  tags: string[];
  category: string;
  docPath: string;
  size: number;
  updated_at: number;
  created_at: number;
  source: KnowledgeSource;
  base: string;
}

export interface AgentTask {
  id: string;
  name: string;
  status: "pending" | "running" | "completed" | "failed" | "lost";
  priority?: "high" | "medium" | "low";
  progress?: number;
  result?: string;
  error?: string;
  created_at: number;
  type?: string;
  subTasks?: AgentTask[];
  logs?: string[];
  tokenUsed?: number;
  description?: string;
  metadata?: Record<string, unknown>;
  templateId?: string;
  scheduleConfig?: ScheduleConfig;
  executionHistory?: ExecutionRecord[];
}

export interface AgentTaskTemplate {
  id: string;
  name: string;
  description?: string;
  prompt: string;
  priority?: "high" | "medium" | "low";
  tags?: string[];
  createdAt: number;
}

export interface ScheduleConfig {
  type: "cron" | "interval" | "once";
  cronExpression?: string;
  intervalMinutes?: number;
  scheduledTime?: number;
  enabled: boolean;
}

export interface ExecutionRecord {
  id: string;
  taskId: string;
  startTime: number;
  endTime?: number;
  status: "completed" | "failed";
  result?: string;
  error?: string;
  tokenUsed?: number;
}

export interface AgentProgress {
  agentId: string;
  state: string;
  progress: number;
  message?: string;
}

export type BuddySpecies =
  | "duck"
  | "goose"
  | "blob"
  | "cat"
  | "dragon"
  | "octopus"
  | "owl"
  | "penguin"
  | "turtle"
  | "snail"
  | "ghost"
  | "axolotl"
  | "capybara"
  | "cactus"
  | "robot"
  | "rabbit"
  | "mushroom"
  | "chonk";

export type BuddyRarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

export type BuddyStat = "DEBUGGING" | "PATIENCE" | "CHAOS" | "WISDOM" | "SNARK";

export type BuddyEye = "·" | "✦" | "×" | "◉" | "@" | "°";

export type BuddyHat =
  | "none"
  | "crown"
  | "tophat"
  | "propeller"
  | "halo"
  | "wizard"
  | "beanie"
  | "tinyduck";

export interface BuddyCompanion {
  name: string;
  species: BuddySpecies;
  rarity: BuddyRarity;
  eye: BuddyEye;
  hat: BuddyHat;
  shiny: boolean;
  stats: Record<BuddyStat, number>;
  level: number;
  experience: number;
  experienceToNext: number;
  hatchedAt: number;
  personality: string;
}

export interface BuddyInteractionResult {
  companion: BuddyCompanion;
  message: string;
  statChanges: Partial<Record<BuddyStat, number>>;
}

export type ScheduleMode = "cron" | "every" | "at";

export interface CronTask {
  id: string;
  name: string;
  expression: string;
  description: string;
  /** 要执行的具体指令内容 */
  prompt?: string;
  enabled: boolean;
  /** 调度模式 */
  scheduleMode?: ScheduleMode;
  /** 人类可读的调度描述（如 "Every 30 minutes"） */
  scheduleDisplay?: string;
  /** 静默模式：完成时不发送通知 */
  silent?: boolean;
  /** 最后运行时间戳 */
  lastRun?: number;
  /** 下次运行时间戳 */
  nextRun?: number;
  /** 上次运行耗时 (ms) */
  lastDurationMs?: number;
  /** 上次运行状态 */
  lastStatus?: "ok" | "error" | "skipped";
  /** 上次错误信息 */
  lastError?: string;
  /** 连续错误次数 */
  consecutiveErrors?: number;
  /** 当前状态 */
  status: "idle" | "running" | "error";
}

export type ChannelType =
  | "wecom"
  | "feishu"
  | "dingtalk"
  | "wechat"
  | "qq"
  | "telegram"
  | "discord"
  | "slack"
  | "line"
  | "whatsapp"
  | "signal"
  | "matrix"
  | "irc"
  | "nostr"
  | "email"
  | "sms"
  | "webhook"
  | "googlechat"
  | "msteams"
  | "zalo"
  | "yuanbao"
  | "facebook"
  | "twitter"
  | "mattermost"
  | "bluebubbles";

export interface Channel {
  id: string;
  name: string;
  type: ChannelType;
  enabled: boolean;
  connected: boolean;
  registered: boolean;
  status?: "online" | "offline" | "error";
  messageCount?: number;
  errorCount?: number;
  config?: Record<string, unknown>;
  lastActive?: number;
}

/** 渠道编辑表单数据 */
export interface ChannelFormData {
  name?: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
}

/** 更新渠道请求 */
export interface UpdateChannelRequest {
  name?: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
}

/** 渠道健康信息 */
export interface ChannelHealth {
  channelId: string;
  connected: boolean;
  healthy: boolean;
  latencyMs?: number;
  messageCount: number;
  errorCount: number;
  lastHeartbeatAt?: number;
}

/** 渠道插件信息 */
export interface ChannelPluginInfo {
  name: string;
  version: string;
  installed: boolean;
  installedAt?: number;
}

export interface DreamLogEntry {
  id: string;
  type: "dream:started" | "dream:completed" | "dream:failed";
  taskId: string;
  summary: string;
  sessionsCount: number;
  insightsGenerated: number;
  timestamp: number;
}

export interface DreamLogResponse {
  logs: DreamLogEntry[];
  total: number;
  stats: {
    totalCompleted: number;
    totalFailed: number;
    totalSessions: number;
    totalInsights: number;
    lastDreamAt: number | null;
  };
}

export interface User {
  id: string;
  username: string;
  email?: string;
  role: "admin" | "user" | "guest";
  trustLevel: 1 | 2 | 3 | 4 | 5;
  created_at: number;
  last_login_at?: number;
}

export interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  created_at: number;
  last_used_at?: number;
  expires_at?: number;
  permissions: string[];
}

export interface Permission {
  scope: string;
  description: string;
  level: "none" | "read" | "write" | "admin";
}

export interface MetricPoint {
  timestamp: number;
  value: number;
  labels?: Record<string, string>;
}

export interface Alert {
  id: string;
  level: "info" | "warn" | "error" | "critical";
  message: string;
  timestamp: number;
  acknowledged: boolean;
  source?: string;
}

export type LogSource = 'logger' | 'structured' | 'otel' | 'llm' | 'all';

export interface LogEntry {
  id: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  timestamp: number;
  source: string;
  module?: string;
  details?: string;
}

export interface SystemHealth {
  status: "healthy" | "degraded" | "unhealthy";
  components: {
    name: string;
    status: "ok" | "warning" | "error";
    message?: string;
  }[];
  timestamp: number;
}

/** 文件预览接口 */
export interface FilePreview {
  /** 文件路径(相对或绝对) */
  path: string;
  /** 文件名 */
  name: string;
  /** 文件内容 */
  content: string;
  /** 文件类型 */
  type: "code" | "markdown" | "json" | "yaml" | "image" | "text" | "pdf" | "docx" | "pptx";
  /** 语言(代码文件) */
  language?: string;
  /** 文件大小 */
  size?: number;
}

/** FileRegistry 记录 —— 对应后端 FileRecord */
export interface FileRegistryRecord {
  id: number;
  fileId: string;
  originalName: string;
  savedName: string;
  savedPath: string;
  md5: string;
  size: number;
  mimeType: string;
  source: string;
  sourceId: string;
  storeZone: string;
  mediaType: string;
  category: string;
  description: string;
  isArchive: boolean;
  archiveParentId: string;
  isDeleted: boolean;
  createdAt: number;
  updatedAt: number;
}

/** 文件搜索/筛选参数 */
export interface FileSearchParams {
  query?: string;
  source?: FileSource | string;
  storeZone?: StoreZone | string;
  startDate?: string;
  endDate?: string;
  cursor?: string;
  limit?: number;
}

/** 文件搜索/列表结果 */
export interface FileSearchResult {
  items: FileRegistryRecord[];
  nextCursor?: string;
  total: number;
}

/** 文件统计概览 */
export interface FileStats {
  totalFiles: number;
  totalSize: number;
  todayInbound: number;
  dedupSaved: number;
  dedupSize: number;
}
