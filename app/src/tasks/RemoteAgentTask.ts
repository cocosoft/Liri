/**
 * 远程Agent任务
 */

import type { AgentDefinition } from './types';
import { BaseTask } from './BaseTask';
import { TaskType, TaskStatus } from './types';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tasks:RemoteAgentTask');

export interface RemoteAgentTaskOptions {
  connectionString: string;
  sessionId?: string;
}

export class RemoteAgentTask extends BaseTask {
  readonly type = TaskType.REMOTE_AGENT;
  private agentDefinition: AgentDefinition;
  private options: RemoteAgentTaskOptions;
  private remoteSession?: any;

  constructor(
    id: string,
    description: string,
    outputFile: string,
    agentDefinition: AgentDefinition,
    options: RemoteAgentTaskOptions
  ) {
    super(id, description, outputFile, TaskType.REMOTE_AGENT);
    this.agentDefinition = agentDefinition;
    this.options = options;
  }

  async spawn(): Promise<void> {
    this.setStatus(TaskStatus.RUNNING);

    try {
      this.remoteSession = await this.connectToRemoteAgent();

      this.remoteSession.on('connected', () => {
        this.emit('progress', this.getProgress());
      });

      this.remoteSession.on('disconnected', (reason?: string) => {
        if (reason) {
          this.setStatus(TaskStatus.FAILED, reason);
        } else {
          this.setStatus(TaskStatus.COMPLETED);
        }
      });

      this.remoteSession.on('error', (error: Error) => {
        this.setStatus(TaskStatus.FAILED, error.message);
      });

      this.remoteSession.on('output', (output: any) => {
        this.handleOutput(output);
      });

      this.remoteSession.on('progress', (progress: any) => {
        this.updateProgress(
          progress.toolUseCount,
          progress.inputTokens,
          progress.outputTokens
        );
      });

      await this.executeRemoteTask();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus(TaskStatus.FAILED, message);
      throw error;
    }
  }

  async kill(): Promise<void> {
    this.abortController.abort();

    if (this.remoteSession) {
      await this.remoteSession.disconnect();
    }

    this.setStatus(TaskStatus.KILLED);
  }

  private async connectToRemoteAgent(): Promise<unknown> {
    const { connectionString, sessionId } = this.options;

    return {
      on: (event: string, callback: Function) => {
        if (event === 'connected') {
          setTimeout(() => callback(), 100);
        }
        return this;
      },
      disconnect: async () => {},
      execute: async (definition: AgentDefinition) => {
        this.emit('output', {
          type: 'info',
          message: `Executing remote agent: ${definition.name}`,
        });
        return { success: true };
      },
    };
  }

  private async executeRemoteTask(): Promise<void> {
    if (this.remoteSession) {
      const result = await this.remoteSession.execute(this.agentDefinition);

      if (result.success) {
        this.setStatus(TaskStatus.COMPLETED);
      } else {
        this.setStatus(
          TaskStatus.FAILED,
          result.error || 'Remote execution failed'
        );
      }
    }
  }

  private handleOutput(output: any): void {
    this.emit('output', output);

    if (output.toolUse) {
      this.addActivity({
        toolName: output.toolUse.name,
        input: output.toolUse.args || {},
        activityDescription: output.toolUse.description,
        isSearch: output.toolUse.isSearch,
        isRead: output.toolUse.isRead,
      });
    }
  }

  getAgentDefinition(): AgentDefinition {
    return { ...this.agentDefinition };
  }

  getConnectionString(): string {
    return this.options.connectionString;
  }

  getSessionId(): string | undefined {
    return this.options.sessionId;
  }
}
