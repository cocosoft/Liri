export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'skipped';

export interface ExecutableTask {
  id: string;
  type: string;
  payload: string;
  priority: number;
  createdAt: number;
  retryCount: number;
  maxRetries: number;
}

export interface ExecutionResult {
  taskId: string;
  success: boolean;
  status: TaskStatus;
  startedAt: number;
  completedAt: number;
  duration: number;
  output?: string;
  error?: string;
}

export interface ExecutionMetrics {
  totalExecuted: number;
  totalSucceeded: number;
  totalFailed: number;
  totalCancelled: number;
  averageDuration: number;
  p99Duration: number;
  lastExecutionTime: number;
}

export interface IExecutionEngine {
  execute(task: ExecutableTask): Promise<ExecutionResult>;
  validateTask(task: ExecutableTask): { valid: boolean; reason?: string };
  cancelExecution(taskId: string): boolean;
  getExecution(taskId: string): ExecutionResult | undefined;
  getMetrics(): ExecutionMetrics;
  clearHistory(): void;
}

export class ExecutionEngine implements IExecutionEngine {
  private history: Map<string, ExecutionResult> = new Map();
  private cancelled: Set<string> = new Set();
  private maxHistorySize = 10000;

  async execute(task: ExecutableTask): Promise<ExecutionResult> {
    const validation = this.validateTask(task);
    if (!validation.valid) {
      const result: ExecutionResult = {
        taskId: task.id,
        success: false,
        status: 'failed',
        startedAt: Date.now(),
        completedAt: Date.now(),
        duration: 0,
        error: validation.reason,
      };
      this.recordResult(result);
      return result;
    }

    if (this.cancelled.has(task.id)) {
      this.cancelled.delete(task.id);
      return {
        taskId: task.id,
        success: false,
        status: 'cancelled',
        startedAt: Date.now(),
        completedAt: Date.now(),
        duration: 0,
      };
    }

    const startedAt = Date.now();
    try {
      const output = await this.runTask(task);
      const completedAt = Date.now();
      const result: ExecutionResult = {
        taskId: task.id,
        success: true,
        status: 'completed',
        startedAt,
        completedAt,
        duration: completedAt - startedAt,
        output,
      };
      this.recordResult(result);
      return result;
    } catch (error) {
      const completedAt = Date.now();
      const isRetryable = task.retryCount < task.maxRetries;
      const result: ExecutionResult = {
        taskId: task.id,
        success: false,
        status: isRetryable ? 'failed' : 'failed',
        startedAt,
        completedAt,
        duration: completedAt - startedAt,
        error: error instanceof Error ? error.message : String(error),
      };
      this.recordResult(result);
      return result;
    }
  }

  validateTask(task: ExecutableTask): { valid: boolean; reason?: string } {
    if (!task.id || task.id.trim().length === 0) {
      return { valid: false, reason: '任务ID不能为空' };
    }
    if (!task.payload || task.payload.trim().length === 0) {
      return { valid: false, reason: '任务内容不能为空' };
    }
    if (task.maxRetries < 0) {
      return { valid: false, reason: '最大重试次数不能为负数' };
    }
    if (task.priority < 0 || task.priority > 100) {
      return { valid: false, reason: '优先级必须在0-100之间' };
    }
    return { valid: true };
  }

  cancelExecution(taskId: string): boolean {
    if (this.history.has(taskId) && this.history.get(taskId)!.status === 'completed') {
      return false;
    }
    this.cancelled.add(taskId);
    return true;
  }

  getExecution(taskId: string): ExecutionResult | undefined {
    return this.history.get(taskId);
  }

  getMetrics(): ExecutionMetrics {
    const results = Array.from(this.history.values());
    const totalExecuted = results.length;
    const totalSucceeded = results.filter(r => r.success).length;
    const totalFailed = results.filter(r => !r.success && r.status === 'failed').length;
    const totalCancelled = results.filter(r => r.status === 'cancelled').length;
    const durations = results.map(r => r.duration).sort((a, b) => a - b);
    const averageDuration = durations.length > 0
      ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length)
      : 0;
    const p99Duration = durations.length > 0
      ? durations[Math.floor(durations.length * 0.99)]
      : 0;
    const lastExecutionTime = results.length > 0
      ? Math.max(...results.map(r => r.completedAt))
      : 0;

    return {
      totalExecuted,
      totalSucceeded,
      totalFailed,
      totalCancelled,
      averageDuration,
      p99Duration,
      lastExecutionTime,
    };
  }

  clearHistory(): void {
    this.history.clear();
    this.cancelled.clear();
  }

  private recordResult(result: ExecutionResult): void {
    if (this.history.size >= this.maxHistorySize) {
      const oldestKey = this.history.keys().next().value;
      if (oldestKey) this.history.delete(oldestKey);
    }
    this.history.set(result.taskId, result);
  }

  private async runTask(task: ExecutableTask): Promise<string> {
    await new Promise(r => setTimeout(r, Math.min(task.priority, 50)));
    return `[${task.type}] 任务 ${task.id} 执行完成: ${task.payload.substring(0, 50)}`;
  }
}
