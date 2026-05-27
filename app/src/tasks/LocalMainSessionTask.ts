/**
 * LocalMainSessionTask - 主会话后台化任务
 *
 * 当用户在查询期间执行后台操作（如 Ctrl+B）时：
 * - 查询在后台继续运行
 * - UI 清除到新的提示行
 * - 查询完成时发送通知
 *
 * 重用 LocalAgentTask 状态结构，因为行为类似
 *
 * 基于 CC源码 cc_code/backend/tasks/LocalMainSessionTask.ts 实现
 */

import type { AgentDefinition, TaskState } from './types';
import { BaseTask } from './BaseTask';
import { TaskType, TaskStatus } from './types';
import { taskRegistry } from './TaskRegistry';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 主会话任务 ID 前缀
 */
const MAIN_SESSION_PREFIX = 's';

/**
 * 生成主会话任务 ID
 */
function generateMainSessionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${MAIN_SESSION_PREFIX}${timestamp}${random}`;
}

/**
 * 主会话任务状态
 */
export interface LocalMainSessionTaskState extends TaskState {
  agentType: 'main-session';
  isBackgrounded: boolean;
  agentId?: string;
}

/**
 * 注册后台主会话任务
 * 当用户后台化当前会话查询时调用
 */
export function registerMainSessionTask(
  description: string,
  agentDefinition?: AgentDefinition
): string {
  const taskId = generateMainSessionId();
  const task = new LocalMainSessionTask(
    taskId,
    description,
    '',
    agentDefinition
  );
  task.markBackgrounded(true);
  taskRegistry.register(task);
  task.spawn().catch((error: Error) => {
    logger.error('Main session task spawn failed', error);
  });
  return taskId;
}

/**
 * 完成主会话任务并发送通知
 */
export function completeMainSessionTask(
  taskId: string,
  success: boolean,
  summary?: string
): void {
  const task = taskRegistry.getTask<LocalMainSessionTask>(taskId);
  if (!task) {
    return;
  }
  task.complete(success, summary);
}

/**
 * 前台化主会话任务
 * 将后台任务标记为前台，使其输出出现在主视图中
 */
export function foregroundMainSessionTask(taskId: string): boolean {
  const task = taskRegistry.getTask<LocalMainSessionTask>(taskId);
  if (!task) {
    return false;
  }
  task.markBackgrounded(false);
  return true;
}

/**
 * 类型守卫：判断任务是否为主会话任务
 */
export function isMainSessionTask(
  task: unknown
): task is LocalMainSessionTaskState {
  if (typeof task !== 'object' || task === null) {
    return false;
  }
  const t = task as Record<string, unknown>;
  return t.type === 'local_agent' && t.agentType === 'main-session';
}

/**
 * LocalMainSessionTask 类
 */
export class LocalMainSessionTask extends BaseTask {
  readonly type = TaskType.LOCAL_AGENT;
  private agentDefinition?: AgentDefinition;
  private backgrounded: boolean;
  private completionSummary?: string;

  constructor(
    id: string,
    description: string,
    outputFile: string,
    agentDefinition?: AgentDefinition
  ) {
    super(id, description, outputFile, TaskType.LOCAL_AGENT);
    this.agentDefinition = agentDefinition;
    this.backgrounded = false;
  }

  async spawn(): Promise<void> {
    this.setStatus(TaskStatus.RUNNING);
    this.emit('output', {
      type: 'main_session_started',
      description: this.state.description,
      backgrounded: this.backgrounded,
    });
  }

  async kill(): Promise<void> {
    this.abortController.abort();
    this.setStatus(TaskStatus.KILLED);
  }

  /**
   * 标记后台/前台状态
   */
  markBackgrounded(backgrounded: boolean): void {
    this.backgrounded = backgrounded;
    this.emit('output', {
      type: 'background_changed',
      backgrounded,
      taskId: this.id,
    });
  }

  /**
   * 是否后台运行
   */
  isBackgrounded(): boolean {
    return this.backgrounded;
  }

  /**
   * 完成任务
   */
  complete(success: boolean, summary?: string): void {
    this.completionSummary = summary;
    this.setStatus(success ? TaskStatus.COMPLETED : TaskStatus.FAILED);
  }

  /**
   * 获取会话状态快照
   */
  getSessionState(): LocalMainSessionTaskState {
    return {
      ...this.state,
      agentType: 'main-session',
      isBackgrounded: this.backgrounded,
    };
  }
}
