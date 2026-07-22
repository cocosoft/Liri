/**
 * Root Store 共享类型定义
 *
 * 定义 Workspace/Worktree、SessionContext、FeatureModule 等核心数据模型。
 * 所有 Slice 从此文件引用类型，避免循环依赖。
 */

import type { Message, ToolCall } from "@/types/message";

// ─── Worktree ──────────────────────────────────────────

/** 工作项状态 */
export type WorkItemStatus =
  "pending" | "running" | "paused" | "review" | "done" | "failed";

/** 工作项 */
export interface WorkItem {
  id: string;
  title: string;
  description: string;
  status: WorkItemStatus;
  worktreeId: string;
  createdAt: number;
  updatedAt: number;
}

/** 执行阶段数据 */
export interface ExecutionPhaseData {
  phase:
    | "analyzing"
    | "designing"
    | "implementing"
    | "verifying"
    | "presenting"
    | null;
  progress: number;
  description: string;
}

/** 工作空间统一模型：环境隔离 + 任务管理 + 会话历史 + UI 布局 */
export interface Worktree {
  id: string;
  name: string;
  /** 关联的文件夹路径（必填，工作空间的核心绑定） */
  path: string;
  description?: string;

  /** 环境隔离 */
  modelConfig: {
    modelId: string;
    providerId: string;
  };
  agentId: string;
  knowledgeBaseIds: string[];

  /** 绑定 Git 仓库 */
  gitRepo?: {
    path: string;
    currentBranch: string;
  };

  /** 任务管理 */
  workItems: WorkItem[];
  executionPhase: ExecutionPhaseData | null;

  /** 会话历史（该工作空间下的 session ID 列表） */
  sessionIds: string[];

  /** 布局状态 */
  layout: WorktreeLayout;

  /** 元数据 */
  createdAt: number;
  updatedAt: number;
}

export interface WorktreeLayout {
  activeModuleId: string | null;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  rightPanelOpen: boolean;
  /** 各模块自行注册的 UI 快照 */
  uiSnapshots: Record<string, Record<string, unknown>>;
}

/** Worktree 切换过程中的资源加载状态 */
export interface WorktreeTransition {
  targetId: string;
  status: "idle" | "pending" | "completed" | "partial";
  errors: { source: string; error: string }[];
}

// ─── Session Context（受歧视联合类型） ─────────────────

export interface ChatSessionContext {
  moduleType: "chat";
  modelId?: string;
  agentId?: string;
}

export interface MediaSessionContext {
  moduleType: "media";
  prompt: string;
  size?: string;
  style?: string;
  negativePrompt?: string;
  currentFile?: string;
}

export interface OfficeSessionContext {
  moduleType: "office";
  fileRef: string;
  templateId?: string;
}

export interface CalendarSessionContext {
  moduleType: "calendar";
  eventId?: string;
  view?: "month" | "week" | "day";
  dateRange?: { start: string; end: string };
}

export interface TranslationSessionContext {
  moduleType: "translation";
  sourceLang: string;
  targetLang: string;
  sourceText?: string;
}

export interface KnowledgeSessionContext {
  moduleType: "knowledge";
  query?: string;
  selectedDocIds?: string[];
}

export type SessionContext =
  | ChatSessionContext
  | MediaSessionContext
  | OfficeSessionContext
  | CalendarSessionContext
  | TranslationSessionContext
  | KnowledgeSessionContext;

/** 统一会话记录 */
export interface SessionRecord {
  id: string;
  moduleType: string;
  worktreeId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  context: SessionContext;
}

// ─── Feature Module ────────────────────────────────────

export interface FeatureModule {
  /** 唯一标识，如 'chat'、'mcp-server' */
  id: string;
  /** 模块类型，如 'chat'、'media'、'mcp'、'skill' */
  type: string;
  name: string;
  icon: string;
  enabled: boolean;
  available: boolean;
  hotkey?: string;
  pinned: boolean;
  /** 模块对应的 URL 路径（用于 auto-create session 映射） */
  paths?: string[];
  /** 模块自带视图组件（动态渲染） */
  component?: React.ComponentType<{ sessionId: string }>;
}

// ─── Git ───────────────────────────────────────────────

export interface GitStatus {
  staged: number;
  modified: number;
  untracked: number;
  branch: string;
  ahead: number;
  behind: number;
}

export interface GitLogEntry {
  hash: string;
  message: string;
  author: string;
  date: string;
}

// ─── Channel ───────────────────────────────────────────

export interface UnifiedMessage {
  id: string;
  channelId: string;
  channelType: "telegram" | "discord" | "email" | "webhook" | "github" | "web";
  worktreeId?: string;
  direction: "inbound" | "outbound";
  content: string;
  metadata: Record<string, unknown>;
  timestamp: number;
  read: boolean;
}

// ─── Re-exports ────────────────────────────────────────

export type { Message, ToolCall };
