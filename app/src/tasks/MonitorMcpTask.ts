/**
 * Monitor MCP任务
 */

import { BaseTask } from './BaseTask';
import { TaskType, TaskStatus } from './types';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'tasks:MonitorMcpTask', level: LogLevel.INFO });

export interface McpMonitorConfig {
  serverUrl: string;
  checkInterval?: number;
  timeout?: number;
}

export interface McpStatus {
  serverUrl: string;
  isOnline: boolean;
  latency: number;
  resourceCount?: number;
  lastCheckTime: number;
}

export class MonitorMcpTask extends BaseTask {
  readonly type = TaskType.MONITOR_MCP;
  private config: McpMonitorConfig;
  private checkIntervalId?: number;
  private statusHistory: McpStatus[] = [];

  constructor(
    id: string,
    description: string,
    outputFile: string,
    config: McpMonitorConfig
  ) {
    super(id, description, outputFile, TaskType.MONITOR_MCP);
    this.config = config;
  }

  async spawn(): Promise<void> {
    this.setStatus(TaskStatus.RUNNING);

    const checkInterval = this.config.checkInterval || 5000;

    this.checkIntervalId = window.setInterval(async () => {
      if (this.abortController.signal.aborted) {
        return;
      }

      await this.checkServerStatus();
    }, checkInterval);

    await this.checkServerStatus();
  }

  async kill(): Promise<void> {
    this.abortController.abort();

    if (this.checkIntervalId) {
      clearInterval(this.checkIntervalId);
    }

    this.setStatus(TaskStatus.KILLED);
  }

  private async checkServerStatus(): Promise<void> {
    const startTime = Date.now();

    try {
      const status: McpStatus = await this.pingServer();
      status.latency = Date.now() - startTime;
      status.lastCheckTime = Date.now();

      this.statusHistory.unshift(status);
      if (this.statusHistory.length > 100) {
        this.statusHistory.pop();
      }

      this.emit('output', {
        type: 'status_update',
        status,
      });

      this.updateProgress(
        this.statusHistory.length,
        0,
        status.isOnline ? 0 : 1
      );
    } catch (error) {
      const status: McpStatus = {
        serverUrl: this.config.serverUrl,
        isOnline: false,
        latency: Date.now() - startTime,
        lastCheckTime: Date.now(),
      };

      this.statusHistory.unshift(status);
      if (this.statusHistory.length > 100) {
        this.statusHistory.pop();
      }

      this.emit('output', {
        type: 'status_update',
        status,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async pingServer(): Promise<McpStatus> {
    return {
      serverUrl: this.config.serverUrl,
      isOnline: true,
      latency: 0,
      resourceCount: Math.floor(Math.random() * 10) + 1,
      lastCheckTime: Date.now(),
    };
  }

  getStatusHistory(): McpStatus[] {
    return [...this.statusHistory];
  }

  getLatestStatus(): McpStatus | undefined {
    return this.statusHistory[0];
  }

  getServerUrl(): string {
    return this.config.serverUrl;
  }
}
