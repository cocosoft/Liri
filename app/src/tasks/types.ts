/**
 * 任务系统类型定义
 */

export enum TaskType {
  LOCAL_BASH = 'local_bash',
  LOCAL_AGENT = 'local_agent',
  REMOTE_AGENT = 'remote_agent',
  IN_PROCESS_TEAMMATE = 'in_process_teammate',
  DREAM = 'dream',
  WORKFLOW = 'local_workflow',
  MONITOR_MCP = 'monitor_mcp',
  BACKGROUND_AGENT = 'background_agent',
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
  outputOffset: number;
  notified: boolean;
  error?: string;
  /** 额外元数据（如 TaskTool 的 owner/priority/activeForm/metadata） */
  metadata?: Record<string, unknown>;
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

export interface TaskContext {
  abortController?: AbortController;
  getAppState?: () => Record<string, unknown>;
  setAppState?: (
    updater: (state: Record<string, unknown>) => Record<string, unknown>
  ) => void;
}

export interface TaskEvent {
  type: 'taskRegistered' | 'stateChanged' | 'progress' | 'output' | 'taskEnded';
  taskId: string;
  state?: TaskState;
  progress?: AgentProgress;
  output?: unknown;
}

// --- 新增类型（对标 Openclaw/CC） ---

/** 任务投递状态 */
export enum TaskDeliveryStatus {
  PENDING = 'pending',
  DELIVERED = 'delivered',
  FAILED = 'failed',
  SKIPPED = 'skipped',
}

/** 通知策略 */
export enum TaskNotifyPolicy {
  DONE_ONLY = 'done_only',
  STATE_CHANGES = 'state_changes',
  SILENT = 'silent',
}

/** 任务流同步模式 */
export type TaskFlowSyncMode = 'task_mirrored' | 'managed';

/** 任务流状态 */
export enum TaskFlowStatus {
  QUEUED = 'queued',
  RUNNING = 'running',
  WAITING = 'waiting',
  BLOCKED = 'blocked',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
}

/** 任务流记录 */
export interface TaskFlowRecord {
  flowId: string;
  syncMode: TaskFlowSyncMode;
  ownerKey: string;
  revision: number;
  status: TaskFlowStatus;
  goal: string;
  currentStep?: string;
  blockedTaskId?: string;
  stateJson?: Record<string, unknown>;
  waitJson?: Record<string, unknown>;
  cancelRequestedAt?: number;
}

/** 任务依赖链（blocks/blockedBy） */
export interface TaskDependency {
  taskId: string;
  blocks?: string[];
  blockedBy?: string[];
}

/** 审计问题类型 */
export type AuditIssueType =
  | 'orphan_subtask'
  | 'stuck_running'
  | 'inconsistent_status'
  | 'missing_parent';

/** 审计问题 */
export interface AuditIssue {
  type: AuditIssueType;
  taskId: string;
  severity: 'error' | 'warning';
  message: string;
}

/** 审计报告 */
export interface AuditReport {
  timestamp: number;
  totalTasks: number;
  issues: AuditIssue[];
  summary: {
    orphanCount: number;
    stuckCount: number;
    inconsistentCount: number;
  };
}

/** 清理结果 */
export interface CleanupResult {
  removedCount: number;
  timedOutCount: number;
  expiredCount: number;
  recoveredCount: number;
  errors: string[];
}

/** 状态快照选项 */
export interface SnapshotOptions {
  recentThresholdMs?: number;
  expiredThresholdMs?: number;
}

/** 状态快照 */
export interface TaskStatusSnapshot {
  active: TaskState[];
  recent: TaskState[];
  expired: TaskState[];
  summary: {
    total: number;
    byStatus: Record<string, number>;
  };
}

// --- 任务优先级 ---
export enum TaskPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent',
}

/** 通用任务接口 */
export interface Task {
  id: string;
  name: string;
  description: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  duration?: number;
  metadata?: Record<string, unknown>;
}

/** 任务创建选项 */
export interface TaskCreateOptions {
  name: string;
  description: string;
  type: TaskType;
  priority?: TaskPriority;
  input?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/** 任务更新选项 */
export interface TaskUpdateOptions {
  name?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  metadata?: Record<string, unknown>;
}

/** 任务查询选项 */
export interface TaskQueryOptions {
  status?: TaskStatus;
  priority?: TaskPriority;
  type?: TaskType;
  limit?: number;
  offset?: number;
  sortBy?: keyof Task;
  sortOrder?: 'asc' | 'desc';
}

/** 任务存储接口 */
export interface TaskStorage {
  create(task: Task): Promise<Task>;
  get(id: string): Promise<Task | undefined>;
  update(id: string, task: Partial<Task>): Promise<Task | undefined>;
  delete(id: string): Promise<boolean>;
  list(options?: TaskQueryOptions): Promise<Task[]>;
  count(options?: TaskQueryOptions): Promise<number>;
}

/** 任务服务接口 */
export interface TaskService {
  createTask(options: TaskCreateOptions): Promise<Task>;
  getTask(id: string): Promise<Task | undefined>;
  updateTask(id: string, options: TaskUpdateOptions): Promise<Task | undefined>;
  deleteTask(id: string): Promise<boolean>;
  listTasks(options?: TaskQueryOptions): Promise<Task[]>;
  countTasks(options?: TaskQueryOptions): Promise<number>;
  startTask(id: string): Promise<Task | undefined>;
  completeTask(
    id: string,
    output?: Record<string, unknown>
  ): Promise<Task | undefined>;
  failTask(id: string, error: string): Promise<Task | undefined>;
  cancelTask(id: string): Promise<Task | undefined>;
}

/** 任务执行器接口 */
export interface TaskExecutor {
  execute(task: Task): Promise<Task>;
  canExecute(task: Task): boolean;
}

/** 任务队列接口 */
export interface TaskQueue {
  enqueue(task: Task): Promise<void>;
  dequeue(): Promise<Task | undefined>;
  size(): Promise<number>;
  clear(): Promise<void>;
}

// --- 后台任务类型（原 BackgroundTaskManager 迁移） ---

/** 后台任务状态（与 BackgroundTaskManager 兼容） */
export type BackgroundTaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'aborted';

/** 后台任务信息 */
export interface BackgroundTaskInfo {
  taskId: string;
  agentName: string;
  agentType: string;
  description: string;
  status: BackgroundTaskStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  progressMessage?: string;
  result?: string;
  error?: string;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  durationMs?: number;
}

/** 后台任务事件 */
export interface BackgroundTaskEvent {
  type: 'created' | 'started' | 'progress' | 'completed' | 'failed' | 'aborted';
  taskId?: string;
  task?: BackgroundTaskInfo;
  message?: string;
  error?: string;
}
