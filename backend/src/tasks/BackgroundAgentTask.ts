/**
 * BackgroundAgentTask - BackgroundTaskManager 到 TaskRegistry 的适配器
 *
 * 将 BackgroundTaskManager 的 BackgroundTaskInfo 包装为 BaseTask 子类型，
 * 使得 /tasks 命令可以统一从 TaskRegistry 读取所有任务数据。
 */

import { BaseTask } from './BaseTask';
import { TaskType, TaskStatus, isTerminalTaskStatus } from './types';
import type { TaskState } from './types';
import type {
  BackgroundTaskInfo,
  BackgroundTaskStatus,
} from '@modules/tools/AgentTool/BackgroundTaskManager.js';

/**
 * 将 BackgroundTaskStatus 映射到 TaskStatus
 */
function mapStatus(bgStatus: BackgroundTaskStatus): TaskStatus {
  switch (bgStatus) {
    case 'pending':
      return TaskStatus.PENDING;
    case 'running':
      return TaskStatus.RUNNING;
    case 'completed':
      return TaskStatus.COMPLETED;
    case 'failed':
      return TaskStatus.FAILED;
    case 'aborted':
      return TaskStatus.KILLED;
  }
}

/**
 * 将 TaskStatus 映射回 BackgroundTaskStatus（用于写回）
 */
function mapToBgStatus(status: TaskStatus): BackgroundTaskStatus {
  switch (status) {
    case TaskStatus.PENDING:
      return 'pending';
    case TaskStatus.RUNNING:
      return 'running';
    case TaskStatus.COMPLETED:
      return 'completed';
    case TaskStatus.FAILED:
      return 'failed';
    case TaskStatus.KILLED:
      return 'aborted';
  }
}

/**
 * 将 BackgroundTaskInfo 转换为 TaskState
 */
export function backgroundTaskInfoToTaskState(
  info: BackgroundTaskInfo,
  taskId?: string
): TaskState {
  return {
    id: taskId || info.taskId,
    type: TaskType.BACKGROUND_AGENT,
    status: mapStatus(info.status),
    description: info.description || info.agentName,
    startTime: info.createdAt,
    endTime: info.completedAt,
    toolUseCount: 0,
    tokenCount: info.tokenUsage?.totalTokens || 0,
    outputFile: '',
    outputOffset: 0,
    notified: isTerminalTaskStatus(mapStatus(info.status)),
    error: info.error,
  };
}

/**
 * BackgroundAgentTask - 包装 BackgroundTaskInfo 的 BaseTask
 *
 * spawn/kill 为存根方法，实际执行由 AgentTool 通过 BackgroundTaskManager 完成。
 * 此适配器仅用于使 TaskRegistry 能统一管理和查询后台 Agent 任务。
 */
export class BackgroundAgentTask extends BaseTask {
  readonly type = TaskType.BACKGROUND_AGENT;
  private bgInfo: BackgroundTaskInfo;

  constructor(info: BackgroundTaskInfo, taskId?: string) {
    const state = backgroundTaskInfoToTaskState(info, taskId);
    super(
      state.id,
      state.description,
      state.outputFile,
      TaskType.BACKGROUND_AGENT
    );
    this.state = state;
    this.bgInfo = info;
  }

  get backgroundInfo(): BackgroundTaskInfo {
    return { ...this.bgInfo };
  }

  async spawn(): Promise<void> {
    this.setStatus(TaskStatus.RUNNING);
  }

  async kill(): Promise<void> {
    this.setStatus(TaskStatus.KILLED);
    this.bgInfo.status = 'aborted';
  }

  /**
   * 从 BackgroundTaskManager 同步状态到 TaskRegistry 的 TaskState
   */
  syncFromBgInfo(info: BackgroundTaskInfo): void {
    this.bgInfo = info;
    this.state.status = mapStatus(info.status);
    this.state.description = info.description || info.agentName;
    this.state.endTime = info.completedAt;
    this.state.tokenCount = info.tokenUsage?.totalTokens || 0;
    this.state.error = info.error;
    this.emit('stateChanged', this.state);
  }
}
