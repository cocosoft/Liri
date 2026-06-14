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