export interface Session {
  id: string;
  title: string;
  created_at: number;
  last_modified_at: number;
  message_count: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  session_id: string;
  tool_calls?: ToolCall[];
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
  status: 'connected' | 'disconnected' | 'error';
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