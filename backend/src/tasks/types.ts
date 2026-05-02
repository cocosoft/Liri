/**
 * 任务系统类型定义
 * 基于CC源码 cc_code/backend/tasks/ 实现
 */

export enum TaskType {
  LOCAL_BASH = 'local_bash',
  LOCAL_AGENT = 'local_agent',
  REMOTE_AGENT = 'remote_agent',
  IN_PROCESS_TEAMMATE = 'in_process_teammate',
  DREAM = 'dream',
  WORKFLOW = 'local_workflow',
  MONITOR_MCP = 'monitor_mcp',
}

export enum TaskStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  KILLED = 'killed',
}

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return (
    status === TaskStatus.COMPLETED ||
    status === TaskStatus.FAILED ||
    status === TaskStatus.KILLED
  );
}

export interface TaskState {
  id: string;
  type: TaskType;
  status: TaskStatus;
  description: string;
  startTime: number;
  endTime?: number;
  toolUseCount: number;
  tokenCount: number;
  outputFile: string;
  notified: boolean;
  error?: string;
}

export interface ToolActivity {
  toolName: string;
  input: Record<string, unknown>;
  activityDescription?: string;
  isSearch?: boolean;
  isRead?: boolean;
}

export interface AgentProgress {
  toolUseCount: number;
  tokenCount: number;
  lastActivity?: ToolActivity;
  recentActivities?: ToolActivity[];
  summary?: string;
}

export interface ProgressTracker {
  toolUseCount: number;
  latestInputTokens: number;
  cumulativeOutputTokens: number;
  recentActivities: ToolActivity[];
}

export function createProgressTracker(): ProgressTracker {
  return {
    toolUseCount: 0,
    latestInputTokens: 0,
    cumulativeOutputTokens: 0,
    recentActivities: [],
  };
}

export interface AgentDefinition {
  name: string;
  description?: string;
  model?: string;
  tools?: string[];
  systemPrompt?: string;
}

export interface BashTaskOptions {
  command: string;
  description?: string;
  timeout?: number;
  cwd?: string;
  env?: Record<string, string>;
}

export interface TaskEvent {
  type: 'taskRegistered' | 'stateChanged' | 'progress' | 'output' | 'taskEnded';
  taskId: string;
  state?: TaskState;
  progress?: AgentProgress;
  output?: any;
}
