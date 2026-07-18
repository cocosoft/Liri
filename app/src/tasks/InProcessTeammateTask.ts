//
/**
 * InProcessTeammateTask - 进程内队友任务
 * 管理in-process teammate的生命周期，包含团队身份、计划模式审批流和消息管理
 * */

import type { Message } from '../chat/types/message';
import { BaseTask } from './BaseTask';
import { TaskType, TaskStatus, isTerminalTaskStatus } from './types';
import type { AgentDefinition, AgentProgress, ToolActivity } from './types';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'tasks:InProcessTeammateTask', level: LogLevel.INFO });

/**
 * Teammate身份标识
 */
export interface TeammateIdentity {
  agentId: string;
  agentName: string;
  teamName: string;
  color?: string;
  planModeRequired: boolean;
  parentSessionId: string;
}

/**
 * InProcessTeammateTask构造选项
 */
export interface InProcessTeammateTaskOptions {
  identity: TeammateIdentity;
  prompt: string;
  model?: string;
  selectedAgent?: AgentDefinition;
  permissionMode?: string;
}

/**
 * InProcessTeammateTask状态
 */
export interface InProcessTeammateTaskState {
  identity: TeammateIdentity;
  prompt: string;
  model?: string;
  selectedAgent?: AgentDefinition;
  awaitingPlanApproval: boolean;
  permissionMode: string;
  error?: string;
  result?: unknown;
  progress?: AgentProgress;
  messages: Message[];
  pendingUserMessages: string[];
  inProgressToolUseIDs: string[];
  isIdle: boolean;
  shutdownRequested: boolean;
  lastReportedToolCount: number;
  lastReportedTokenCount: number;
}

const MAX_MESSAGES = 500;

function appendCappedMessage(messages: Message[], message: Message): Message[] {
  const updated = [...messages, message];
  if (updated.length > MAX_MESSAGES) {
    return updated.slice(updated.length - MAX_MESSAGES);
  }
  return updated;
}

/**
 * InProcessTeammateTask类
 */
export class InProcessTeammateTask extends BaseTask {
  readonly type = TaskType.IN_PROCESS_TEAMMATE;
  private teammateOptions: InProcessTeammateTaskOptions;
  private teammateState: InProcessTeammateTaskState;
  private teammateBackendHandle: any;

  constructor(
    id: string,
    description: string,
    outputFile: string,
    options: InProcessTeammateTaskOptions
  ) {
    super(id, description, outputFile, TaskType.IN_PROCESS_TEAMMATE);
    this.teammateOptions = options;
    this.teammateState = {
      identity: options.identity,
      prompt: options.prompt,
      model: options.model,
      selectedAgent: options.selectedAgent,
      awaitingPlanApproval: false,
      permissionMode: options.permissionMode || 'accept',
      messages: [],
      pendingUserMessages: [],
      inProgressToolUseIDs: [],
      isIdle: false,
      shutdownRequested: false,
      lastReportedToolCount: 0,
      lastReportedTokenCount: 0,
    };
  }

  async spawn(): Promise<void> {
    this.setStatus(TaskStatus.RUNNING);

    try {
      const { InProcessTeammateBackend } =
        await import('../subagent/backends/InProcessTeammateBackend');

      const backend = new InProcessTeammateBackend();
      const handle = await backend.spawn({
        name: this.teammateOptions.identity.agentName,
        model: this.teammateOptions.model,
        systemPrompt: this.teammateOptions.prompt,
        capabilities: ['in_process_teammate'],
      });

      this.teammateBackendHandle = handle;

      backend.onMessage(handle, (message: Message) => {
        this.teammateState.messages = appendCappedMessage(
          this.teammateState.messages,
          message
        );
        this.emit('output', { type: 'message', message });
      });

      backend.onStatusChange(handle, (status: string) => {
        if (status === 'stopped') {
          this.setStatus(TaskStatus.COMPLETED);
        } else if (status === 'error') {
          this.setStatus(TaskStatus.FAILED, 'Teammate backend error');
        }
      });

      this.emit('output', {
        type: 'teammate_started',
        identity: this.teammateOptions.identity,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus(TaskStatus.FAILED, message);
      throw error;
    }
  }

  async kill(): Promise<void> {
    this.abortController.abort();

    this.teammateState.shutdownRequested = true;

    if (this.teammateBackendHandle) {
      try {
        const { InProcessTeammateBackend } =
          await import('../subagent/backends/InProcessTeammateBackend');

        const backend = new InProcessTeammateBackend();
        await backend.kill(this.teammateBackendHandle);
      } catch (err) {

        // Ignore kill errors during cleanup

        logger.debug("Operation skipped", { context: "Ignore kill errors during cleanup", error: err instanceof Error ? err.message : String(err) });

      }
    }

    this.setStatus(TaskStatus.KILLED);
  }

  /**
   * 请求队友关闭
   */
  requestShutdown(): void {
    if (
      this.status !== TaskStatus.RUNNING ||
      this.teammateState.shutdownRequested
    ) {
      return;
    }
    this.teammateState.shutdownRequested = true;
  }

  /**
   * 追加消息到队友对话历史
   */
  appendMessage(message: Message): void {
    if (this.status !== TaskStatus.RUNNING) {
      return;
    }
    this.teammateState.messages = appendCappedMessage(
      this.teammateState.messages,
      message
    );
  }

  /**
   * 注入用户消息到队友待处理队列
   */
  injectUserMessage(content: string): void {
    if (isTerminalTaskStatus(this.state.status)) {
      return;
    }
    this.teammateState.pendingUserMessages.push(content);
    this.teammateState.messages = appendCappedMessage(
      this.teammateState.messages,
      {
        role: 'user',
        content,
        id: `msg-${Date.now()}`,
        ts: Date.now(),
      } as unknown as Message
    );
  }

  /**
   * 设置空闲状态
   */
  setIdle(idle: boolean): void {
    this.teammateState.isIdle = idle;
    if (idle) {
      this.emit('output', { type: 'teammate_idle' });
    }
  }

  /**
   * 设置待审批状态
   */
  setAwaitingPlanApproval(awaiting: boolean): void {
    this.teammateState.awaitingPlanApproval = awaiting;
  }

  /**
   * 获取队友状态
   */
  getTeammateState(): InProcessTeammateTaskState {
    return { ...this.teammateState };
  }

  /**
   * 获取队友身份
   */
  getIdentity(): TeammateIdentity {
    return { ...this.teammateOptions.identity };
  }
}

/**
 * 类型守卫：判断是否为InProcessTeammateTask状态
 */
export function isInProcessTeammateTaskState(
  state: unknown
): state is InProcessTeammateTaskState {
  return (
    typeof state === 'object' &&
    state !== null &&
    'identity' in state &&
    'prompt' in state
  );
}
