/**
 * 任务模型类型定义
 */

/**
 * 任务状态
 */
export enum TaskStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

/**
 * 任务优先级
 */
export enum TaskPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent',
}

/**
 * 任务类型
 */
export enum TaskType {
  AI_GENERATION = 'ai_generation',
  FILE_OPERATION = 'file_operation',
  COMMAND_EXECUTION = 'command_execution',
  CHAT_SESSION = 'chat_session',
  AGENT_TASK = 'agent_task',
  OTHER = 'other',
}

/**
 * 任务接口
 */
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

/**
 * 任务创建选项
 */
export interface TaskCreateOptions {
  name: string;
  description: string;
  type: TaskType;
  priority?: TaskPriority;
  input?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * 任务更新选项
 */
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

/**
 * 任务查询选项
 */
export interface TaskQueryOptions {
  status?: TaskStatus;
  priority?: TaskPriority;
  type?: TaskType;
  limit?: number;
  offset?: number;
  sortBy?: keyof Task;
  sortOrder?: 'asc' | 'desc';
}

/**
 * 任务存储接口
 */
export interface TaskStorage {
  create(task: Task): Promise<Task>;
  get(id: string): Promise<Task | undefined>;
  update(id: string, task: Partial<Task>): Promise<Task | undefined>;
  delete(id: string): Promise<boolean>;
  list(options?: TaskQueryOptions): Promise<Task[]>;
  count(options?: TaskQueryOptions): Promise<number>;
}

/**
 * 任务服务接口
 */
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

/**
 * 任务执行器接口
 */
export interface TaskExecutor {
  execute(task: Task): Promise<Task>;
  canExecute(task: Task): boolean;
}

/**
 * 任务队列接口
 */
export interface TaskQueue {
  enqueue(task: Task): Promise<void>;
  dequeue(): Promise<Task | undefined>;
  size(): Promise<number>;
  clear(): Promise<void>;
}
