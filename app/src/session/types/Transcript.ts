/**
 * Transcript类型定义
 * 对标CC源码的sessionStorage.ts中的Transcript相关功能
 */

import type { UnifiedMessage } from './Message.js';
import type { UnifiedSession } from './Session.js';

/**
 * Transcript条目类型
 */
export type TranscriptEntry = UnifiedMessage | TranscriptAnnotation;

/**
 * 记录注解类型
 */
export type TranscriptAnnotation =
  | SummaryAnnotation
  | CustomTitleAnnotation
  | AiTitleAnnotation
  | LastPromptAnnotation
  | TaskSummaryAnnotation
  | TagAnnotation
  | AgentNameAnnotation
  | AgentColorAnnotation
  | AgentSettingAnnotation
  | PRLinkAnnotation
  | FileHistorySnapshotAnnotation
  | AttributionSnapshotAnnotation
  | SpeculationAcceptAnnotation;

/**
 * 摘要注解
 */
export interface SummaryAnnotation {
  type: 'summary';
  summary: string;
  summaryId: string;
}

/**
 * 自定义标题注解
 */
export interface CustomTitleAnnotation {
  type: 'custom_title';
  title: string;
}

/**
 * AI标题注解
 */
export interface AiTitleAnnotation {
  type: 'ai_title';
  title: string;
}

/**
 * 最后提示注解
 */
export interface LastPromptAnnotation {
  type: 'last_prompt';
  prompt: string;
}

/**
 * 任务摘要注解
 */
export interface TaskSummaryAnnotation {
  type: 'task_summary';
  summary: string;
  taskId: string;
}

/**
 * 标签注解
 */
export interface TagAnnotation {
  type: 'tag';
  tags: string[];
}

/**
 * Agent名称注解
 */
export interface AgentNameAnnotation {
  type: 'agent_name';
  name: string;
}

/**
 * Agent颜色注解
 */
export interface AgentColorAnnotation {
  type: 'agent_color';
  color: string;
}

/**
 * Agent设置注解
 */
export interface AgentSettingAnnotation {
  type: 'agent_setting';
  setting: Record<string, unknown>;
}

/**
 * PR链接注解
 */
export interface PRLinkAnnotation {
  type: 'pr_link';
  prUrl: string;
  prNumber?: number;
}

/**
 * 文件历史快照注解
 */
export interface FileHistorySnapshotAnnotation {
  type: 'file_history_snapshot';
  snapshot: FileHistorySnapshot;
}

/**
 * 文件历史快照内容
 */
export interface FileHistorySnapshot {
  files: FileSnapshot[];
  timestamp: number;
}

/**
 * 单个文件快照
 */
export interface FileSnapshot {
  path: string;
  hash: string;
  lines?: number;
}

/**
 * 属性快照注解
 */
export interface AttributionSnapshotAnnotation {
  type: 'attribution_snapshot';
  snapshot: AttributionSnapshot;
}

/**
 * 属性快照内容
 */
export interface AttributionSnapshot {
  citations: Citation[];
  timestamp: number;
}

/**
 * 引用信息
 */
export interface Citation {
  source: string;
  excerpt: string;
  score?: number;
}

/**
 * 推测接受注解
 */
export interface SpeculationAcceptAnnotation {
  type: 'speculation_accept';
  speculationId: string;
}

/**
 * Transcript接口
 */
export interface Transcript {
  sessionId: string;
  entries: TranscriptEntry[];
  createdAt: number;
  updatedAt: number;
  version: string;
  /** 产生该转录的 Agent 名称 */
  agentName?: string;
}

/**
 * Transcript加载选项
 */
export interface LoadTranscriptOptions {
  limit?: number;
  offset?: number;
  startDate?: number;
  endDate?: number;
  includeAnnotations?: boolean;
}

/**
 * Transcript保存选项
 */
export interface SaveTranscriptOptions {
  enableCompression?: boolean;
  encoding?: 'jsonl' | 'json';
  maxFileSize?: number;
}

/**
 * Transcript配置
 */
export interface TranscriptConfig {
  maxFileSize?: number;
  encoding?: 'jsonl' | 'json';
  enableCompression?: boolean;
  includeMetadata?: boolean;
}

/**
 * Agent Transcript路径配置
 */
export interface AgentTranscriptConfig {
  agentId: string;
  sessionId: string;
  subdir?: string;
}

/**
 * Transcript统计信息
 */
export interface TranscriptStats {
  totalEntries: number;
  totalMessages: number;
  totalAnnotations: number;
  fileSize: number;
  lastUpdated: number;
}

/**
 * Transcript搜索结果
 */
export interface TranscriptSearchResult {
  sessionId: string;
  entries: TranscriptEntry[];
  matchedQuery: string;
  score: number;
}

/**
 * 临时进度消息类型（不持久化到Transcript）
 */
export const EPHEMERAL_PROGRESS_TYPES = new Set([
  'bash_progress',
  'powershell_progress',
  'mcp_progress',
  'sleep_progress',
]);

/**
 * 判断是否为临时进度消息
 * @param dataType 消息类型
 */
export function isEphemeralToolProgress(dataType: unknown): boolean {
  return typeof dataType === 'string' && EPHEMERAL_PROGRESS_TYPES.has(dataType);
}

/**
 * 判断是否为Transcript消息（需要持久化）
 * @param entry 条目
 */
export function isTranscriptMessage(entry: unknown): entry is UnifiedMessage {
  if (typeof entry !== 'object' || entry === null) {
    return false;
  }
  const obj = entry as Record<string, unknown>;
  return (
    'type' in obj &&
    typeof obj.type === 'string' &&
    'id' in obj &&
    typeof obj.id === 'string'
  );
}

/**
 * 判断是否为Chain参与者
 * @param message 消息
 */
export function isChainParticipant(
  message: Pick<UnifiedMessage, 'type'>
): boolean {
  return message.type === 'user' || message.type === 'assistant';
}

/**
 * 最大Transcript读取字节数（50MB）
 */
export const MAX_TRANSCRIPT_READ_BYTES = 50 * 1024 * 1024;

/**
 * Agent元数据
 */
export interface AgentMetadata {
  agentType: string;
  worktreePath?: string;
  description?: string;
}

/**
 * 远程Agent元数据
 */
export interface RemoteAgentMetadata {
  taskId: string;
  remoteTaskType: string;
  sessionId: string;
  title: string;
  command: string;
  spawnedAt: number;
  toolUseId?: string;
  isLongRunning?: boolean;
  isUltraplan?: boolean;
  isRemoteReview?: boolean;
  remoteTaskMetadata?: Record<string, unknown>;
}
