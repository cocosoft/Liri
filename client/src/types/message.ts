/** 聊天中附带的图片信息 */
export interface AttachedImage {
  /** 上传后的后端文件路径（绝对路径） */
  path: string;
  /** HTTP 可访问的 URL */
  url: string;
  /** 原始文件名 */
  filename: string;
  /** 文件大小（字节） */
  size: number;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: number;
  /** 流式开始时间（毫秒，1.6：与 timestamp 完成时间区分，导出显示开始时间与耗时） */
  startedAt?: number;
  /** B-1（2026-08-23）：事件派生排序键（后端派生消息的 lastEventSeq，setMessages 排序用） */
  lastEventSeq?: number;
  session_id: string;
  tool_calls?: ToolCall[];
  blocks?: MessageBlock[];
  toolCallId?: string;
  error?: string;
  replyToId?: string;
  /** 产生该消息的 Agent 名称 */
  agentName?: string;
  /** 用户消息附带的图片 */
  attachedImages?: AttachedImage[];
  /** 元数据（含安全拦截标记等） */
  metadata?: Record<string, unknown>;
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
  type:
    | "text"
    | "thinking"
    | "tool_call"
    | "status"
    | "task_decomposition"
    | "question"
    | "todo"
    | "progress"
    | "deliverable"
    | "diff"
    | "inbox"
    | "doc_workflow";
  content: string;
  toolCall?: ToolCall;
  /** 事件派生块字段（后端 EventMessageDeriver.makeBlock）：toolName/args 为 toolCall 的扁平化，加载时归一化 */
  toolName?: string;
  args?: Record<string, unknown>;
  status?: string;
  /** 状态块阶段（如压缩 compaction：compacting=进行中 / done=完成），CS02 结构化标记 */
  phase?: "compacting" | "done";
  /** 结构化水位数据（status === "watermark" 时存在），CS02：替代对 content 的正则解析 */
  watermark?: { pct: number; severity: "warn" | "compact" };
  isStreaming?: boolean;
  toolCallId?: string;
  groupId?: string;
  taskCard?: TaskCardData;
  questionData?: QuestionData;
  progressData?: ProgressData;
  deliverableData?: DeliverableData;
  diffData?: DiffData;
  inboxData?: InboxBlockData;
  docWorkflowData?: DocWorkflowProgressData;
}

export interface TaskCardData {
  title: string;
  tasks: TaskCardTask[];
  status: "planning" | "executing" | "done";
  /** P2（08-09）：关联的 PlanDrivenLoop planId，用于 SSE 实时更新 */
  planId?: string;
}

export interface TaskCardTask {
  id: string;
  name: string;
  status:
    | "pending"
    | "in_progress"
    | "completed"
    | "failed"
    | "cancelled"
    | "blocked"
    | "skipped";
  dependsOn: string[];
  result?: string;
  durationMs?: number;
}

/** 进度数据——由 ExecutionPhaseTracker 推送的流式进度信息 */
export interface ProgressData {
  phase:
    "analyzing" | "designing" | "implementing" | "verifying" | "presenting";
  progress: number; // 0-100
  description: string;
  steps: {
    name: string;
    status: "pending" | "in_progress" | "done" | "failed";
  }[];
  /** 完整步骤数（后端截断前），用于显示真实计数 */
  totalSteps?: number;
  /** 后端是否截断了旧步骤（仅保留最近 N 条） */
  truncated?: boolean;
  currentStep: string;
}

/** 交付物数据——AI 完成工作后推送的文件变更列表 */
export interface DeliverableData {
  files: {
    path: string;
    change: "added" | "modified" | "deleted";
    status: "pending" | "verified" | "failed";
  }[];
  summary: string;
  checks?: { name: string; passed: boolean; detail?: string }[];
  actions?: {
    label: string;
    action: "accept" | "reject" | "retry";
    file?: string;
  }[];
}

/** diff 数据——AI 代码变更的 unified diff 格式预览 */
export interface DiffData {
  file: string;
  diff: string;
  language?: string;
  stats?: { additions: number; deletions: number };
}

/** Inbox 审批/提问交互卡片数据 */
export interface InboxBlockData {
  inboxId: string;
  type: "approval" | "question" | "authorization";
  title: string;
  content: string;
  status: "pending" | "replied" | "expired";
  priority?: "urgent" | "normal" | "low";
  actions: Array<{
    label: string;
    reply: string;
    style: "primary" | "danger" | "secondary";
  }>;
  channelSource?: string;
  expiresAt?: number;
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
  /** P2-2: 工具审批等待态标记（ask 决策），区别于失败（结构化信号，非字符串匹配） */
  pendingApproval?: boolean;
  /** 标记 result 为截断摘要，全量结果通过 getToolResultFull(id) 获取 */
  _hasFullResult?: boolean;
  /** 工具执行失败原因（status='failed' 时存在，日志面板据此展示失败详情） */
  error?: string;
}

// ============================================================
// 子组件 Props 接口 — 接口契约先行，组件拆分前定义
// ============================================================

/** MessageHeader 子组件 Props */
export interface MessageHeaderProps {
  role: "user" | "assistant" | "system" | "tool";
  timestamp: number;
  channel?: "web" | "terminal";
  status?: "sending" | "sent" | "error";
}

/** 文档工作流阶段类型 */
export type DocWorkflowStage = "outline" | "filling" | "compose";

/** 文档工作流阶段状态 */
export type DocWorkflowStageStatus =
  "pending" | "in_progress" | "awaiting_confirm" | "completed" | "failed";

/** 文档工作流进度数据（设计方案 §4 M3） */
export interface DocWorkflowProgressData {
  /** 文档标题 */
  title: string;
  /** 输出格式 */
  format: "docx" | "pptx" | "html" | "pdf";
  /** 当前阶段 */
  currentStage: DocWorkflowStage;
  /** 阶段状态 */
  stages: Record<
    DocWorkflowStage,
    {
      status: DocWorkflowStageStatus;
      /** 阶段内进度（0-100） */
      progress?: number;
      /** 阶段描述 */
      description?: string;
      /** 节点级进度（大纲/填充阶段使用） */
      nodes?: {
        id: string;
        title: string;
        status: "pending" | "in_progress" | "completed" | "failed";
        hasImage?: boolean;
      }[];
    }
  >;
  /** 最终输出文件路径（compose 完成后填充） */
  outputFilePath?: string;
  /** 失败原因 */
  error?: string;
}

/** MessageContent 子组件 Props */
export interface MessageContentProps {
  content: string;
  blocks?: MessageBlock[];
  isStreaming?: boolean;
  messageId: string;
}

/** MessageActions 子组件 Props */
export interface MessageActionsProps {
  messageId: string;
  role: "user" | "assistant" | "system" | "tool";
  isStreaming?: boolean;
  /** 是否为最后一条 AI 消息（控制"重新生成"按钮显示） */
  isLastAiMessage?: boolean;
  /** 消息是否被截断（控制"继续生成"按钮显示） */
  isTruncated?: boolean;
  finishReason?: "stop" | "length" | "max_tokens" | "tool_calls";
}

/** ToolCallInline 子组件 Props（扁平化后的工具调用展示） */
export interface ToolCallInlineProps {
  toolCall: ToolCall;
  /** 点击展开详情的回调 */
  onExpand?: (toolCall: ToolCall) => void;
}

/** ToolCallGroup 子组件 Props（扁平化后的工具执行组） */
export interface ToolCallGroupProps {
  blocks: MessageBlock[];
  isStreaming?: boolean;
  /** 组标题（如 "工具执行"） */
  title?: string;
}

/** TaskCard 子组件 Props */
export interface TaskCardProps {
  data: TaskCardData;
  isStreaming?: boolean;
}

/** InputComposer 子组件 Props */
export interface InputComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
  placeholder?: string;
  /** 是否正在流式输出（控制停止按钮显示） */
  isStreaming?: boolean;
  onStop?: () => void;
}

/** StreamIndicator 子组件 Props（流式光标指示器） */
export interface StreamIndicatorProps {
  /** 是否正在流式输出 */
  active: boolean;
}
