/**
 * ChatArea 共享类型定义
 *
 * 统一管理会话展示区组件的跨组件 Props 类型，
 * 避免各组件文件内重复声明。
 */

import type { MessageBlock, ToolCall } from "./message";
import type {
  TaskCardData,
  QuestionData,
  ProgressData,
  DeliverableData,
  DiffData,
} from "./message";

// ============================================================================
// Block 渲染上下文
// ============================================================================

/** BlockRenderer 向下透传的渲染上下文 */
export interface BlockRenderContext {
  /** 当前会话 ID，用于跳转工作模式 */
  sessionId?: string;
  /** 已知的文件路径列表，用于 InlineCodeLink 路径解析 */
  knownFilePaths?: string[];
  /** 是否正在流式输出中 */
  isStreaming?: boolean;
}

// ============================================================================
// 文件链接上下文
// ============================================================================

/** FileLink / InlineCodeLink 的路径解析上下文 */
export interface FileLinkContext {
  /** 项目根目录路径 */
  projectRoot?: string;
  /** 已知存在的文件列表 */
  knownFiles?: string[];
}

// ============================================================================
// 工具执行上下文
// ============================================================================

/** ToolExecutionGroup / ToolCallGroup 共享的执行上下文 */
export interface ToolExecutionContext {
  /** 关联的消息 blocks */
  blocks: MessageBlock[];
  /** 工具调用信息 */
  toolCall: ToolCall;
  /** 是否深色模式 */
  isDark?: boolean;
}

// ============================================================================
// 块渲染器 Props
// ============================================================================

/** BlockRenderer 组件的 Props */
export interface BlockRendererProps {
  block: MessageBlock;
  sessionId?: string;
  knownFilePaths?: string[];
  onQuestionResponse?: (content: string) => void;
}

/** StatusBlock Props */
export interface StatusBlockProps {
  content: string;
  isStreaming?: boolean;
  status?: string;
}

/** ThinkingBlock Props */
export interface ThinkingBlockProps {
  content: string;
  isStreaming?: boolean;
}

/** ToolCallGroup Props */
export interface ToolCallGroupProps {
  toolCall: ToolCall;
  isStreaming?: boolean;
  variant?: "card" | "inline";
}

/** TaskCard Props */
export interface TaskCardProps {
  data: TaskCardData;
}

/** QuestionBlock Props */
export interface QuestionBlockProps {
  questionData: QuestionData;
  sessionId?: string;
  onResponse?: (content: string) => void;
}

/** ProgressCard Props */
export interface ProgressCardProps {
  data: ProgressData;
}

/** DeliverableCard Props */
export interface DeliverableCardProps {
  data: DeliverableData;
  onEnterWorkMode?: () => void;
  workModeReady?: boolean;
}

/** DiffBlock Props */
export interface DiffBlockProps {
  data: DiffData;
}

/** MarkdownRenderer Props */
export interface MarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
  onPreviewFile?: (filePath: string) => void;
  knownFilePaths?: string[];
}

// ============================================================================
// 会话列表
// ============================================================================

/** SessionHistorySidebar 中单条会话的 Props */
export interface SessionListItemProps {
  id: string;
  title: string;
  createdAt: string;
  messageCount: number;
  isActive: boolean;
  isPinned?: boolean;
  isSelected?: boolean;
  onSelect?: (id: string) => void;
  onDelete?: (id: string) => void;
  onRename?: (id: string, title: string) => void;
  onSwitch?: (id: string) => void;
}

/** ReEntryBanner Props（回切摘要横幅） */
export interface ReEntryBannerProps {
  sessionTitle: string;
  awayMinutes: number;
  newMessageCount: number;
  onScrollToLatest: () => void;
  onShowSummary: () => void;
  onDismiss: () => void;
}
