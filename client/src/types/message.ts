export interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: number;
  session_id: string;
  tool_calls?: ToolCall[];
  blocks?: MessageBlock[];
  toolCallId?: string;
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
  type: "text" | "thinking" | "tool_call" | "status" | "task_decomposition" | "question" | "todo" | "progress" | "deliverable" | "diff";
  content: string;
  toolCall?: ToolCall;
  status?: string;
  isStreaming?: boolean;
  toolCallId?: string;
  groupId?: string;
  taskCard?: TaskCardData;
  questionData?: QuestionData;
  progressData?: ProgressData;
  deliverableData?: DeliverableData;
  diffData?: DiffData;
}

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

/** 进度数据——由 ExecutionPhaseTracker 推送的流式进度信息 */
export interface ProgressData {
  phase: "analyzing" | "designing" | "implementing" | "verifying" | "presenting";
  progress: number;          // 0-100
  description: string;
  steps: { name: string; status: "pending" | "in_progress" | "done" | "failed" }[];
  currentStep: string;
}

/** 交付物数据——AI 完成工作后推送的文件变更列表 */
export interface DeliverableData {
  files: { path: string; change: "added" | "modified" | "deleted"; status: "pending" | "verified" | "failed" }[];
  summary: string;
  checks?: { name: string; passed: boolean; detail?: string }[];
  actions?: { label: string; action: "accept" | "reject" | "retry"; file?: string }[];
}

/** diff 数据——AI 代码变更的 unified diff 格式预览 */
export interface DiffData {
  file: string;
  diff: string;
  language?: string;
  stats?: { additions: number; deletions: number };
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