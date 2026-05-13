/**
 * 本地Agent任务
 * 基于CC源码 cc_code/backend/tasks/LocalAgentTask.ts 实现
 */

import type { AgentDefinition } from './types';
import { BaseTask } from './BaseTask';
import { TaskType, TaskStatus } from './types';

export class LocalAgentTask extends BaseTask {
  readonly type = TaskType.LOCAL_AGENT;
  private agentDefinition: AgentDefinition;
  private parentTaskId?: string;
  private agentProcess?: any;

  constructor(
    id: string,
    description: string,
    outputFile: string,
    agentDefinition: AgentDefinition,
    parentTaskId?: string
  ) {
    super(id, description, outputFile, TaskType.LOCAL_AGENT);
    this.agentDefinition = agentDefinition;
    this.parentTaskId = parentTaskId;
  }

  async spawn(): Promise<void> {
    this.setStatus(TaskStatus.RUNNING);

    try {
      this.agentProcess = await this.launchAgent();

      this.agentProcess.on('exit', (code: number) => {
        if (code === 0) {
          this.setStatus(TaskStatus.COMPLETED);
        } else {
          this.setStatus(TaskStatus.FAILED, `Agent exited with code ${code}`);
        }
      });

      this.agentProcess.on('error', (error: Error) => {
        this.setStatus(TaskStatus.FAILED, error.message);
      });

      if (this.agentProcess.output) {
        for await (const update of this.agentProcess.output) {
          this.handleOutput(update);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus(TaskStatus.FAILED, message);
      throw error;
    }
  }

  async kill(): Promise<void> {
    this.abortController.abort();

    if (this.agentProcess) {
      if (typeof this.agentProcess.kill === 'function') {
        this.agentProcess.kill('SIGTERM');
      }

      await this.waitForProcessExit(this.agentProcess, 5000);

      if (
        typeof this.agentProcess.killed === 'boolean' &&
        !this.agentProcess.killed
      ) {
        if (typeof this.agentProcess.kill === 'function') {
          this.agentProcess.kill('SIGKILL');
        }
      }
    }

    this.setStatus(TaskStatus.KILLED);
  }

  private async launchAgent(): Promise<unknown> {
    return {
      on: (event: string, callback: Function) => {
        return this;
      },
      output: {
        then: (resolve: Function) => {
          resolve([]);
        },
      },
      kill: () => {},
    };
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

  private async waitForProcessExit(
    process: any,
    timeout: number
  ): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, timeout);
    });
  }

  getParentTaskId(): string | undefined {
    return this.parentTaskId;
  }

  getAgentDefinition(): AgentDefinition {
    return { ...this.agentDefinition };
  }
}
