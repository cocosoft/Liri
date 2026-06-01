export interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  session_id: string;
  tool_calls?: ToolCall[];
  blocks?: MessageBlock[];
  toolCallId?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  };
}

export interface MessageBlock {
  id: string;
  type: 'text' | 'thinking' | 'tool_call' | 'status';
  content: string;
  toolCall?: ToolCall;
  status?: string;
  isStreaming?: boolean;
  toolCallId?: string;
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
  status?: 'running' | 'completed' | 'failed';
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  type: 'chat' | 'embedding' | 'image';
  context_length: number;
  enabled: boolean;
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
  type: 'file' | 'directory';
  size?: number;
  modified_at?: number;
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
  | 'manual'
  | 'auto-memory'
  | 'upload'
  | 'chat-save'
  | 'dream'
  | 'compiled';

export interface KnowledgeBase {
  name: string;
  label: string;
  enabled: boolean;
  docCount: number;
  icon: string;
  createdAt: number;
  source: 'system' | 'user';
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
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress?: number;
  result?: string;
  error?: string;
  created_at: number;
  type?: string;
  subTasks?: AgentTask[];
  logs?: string[];
  tokenUsed?: number;
}

export interface AgentProgress {
  agentId: string;
  state: string;
  progress: number;
  message?: string;
}

export type BuddySpecies =
  | 'duck' | 'goose' | 'blob' | 'cat' | 'dragon' | 'octopus'
  | 'owl' | 'penguin' | 'turtle' | 'snail' | 'ghost' | 'axolotl'
  | 'capybara' | 'cactus' | 'robot' | 'rabbit' | 'mushroom' | 'chonk';

export type BuddyRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export type BuddyStat = 'DEBUGGING' | 'PATIENCE' | 'CHAOS' | 'WISDOM' | 'SNARK';

export type BuddyEye = '·' | '✦' | '×' | '◉' | '@' | '°';

export type BuddyHat = 'none' | 'crown' | 'tophat' | 'propeller' | 'halo' | 'wizard' | 'beanie' | 'tinyduck';

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

export interface CronTask {
  id: string;
  name: string;
  expression: string;
  description: string;
  enabled: boolean;
  lastRun?: number;
  nextRun?: number;
  status: 'idle' | 'running' | 'error';
}

export interface Channel {
  id: string;
  name: string;
  type: 'qq' | 'feishu' | 'dingtalk' | 'wechat' | 'slack' | 'discord' | 'telegram' | 'whatsapp' | 'email' | 'webhook';
  enabled: boolean;
  connected: boolean;
  config?: Record<string, unknown>;
  lastActive?: number;
}

export interface DreamLogEntry {
  id: string;
  type: 'dream:started' | 'dream:completed' | 'dream:failed';
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
  role: 'admin' | 'user' | 'guest';
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
  level: 'none' | 'read' | 'write' | 'admin';
}

export interface MetricPoint {
  timestamp: number;
  value: number;
  labels?: Record<string, string>;
}

export interface Alert {
  id: string;
  level: 'info' | 'warn' | 'error' | 'critical';
  message: string;
  timestamp: number;
  acknowledged: boolean;
  source?: string;
}

export interface LogEntry {
  id: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: number;
  source?: string;
  details?: string;
}

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  components: {
    name: string;
    status: 'ok' | 'warning' | 'error';
    message?: string;
  }[];
  timestamp: number;
}