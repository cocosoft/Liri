/**
 * Monitor MCP任务
 */

import { BaseTask } from './BaseTask';
import { TaskType, TaskStatus } from './types';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tasks:MonitorMcpTask');

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
  private checkIntervalId?: ReturnType<typeof setInterval>;
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

    this.checkIntervalId = setInterval(async () => {
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
    const url = this.config.serverUrl;
    const timeout = this.config.timeout ?? 5000;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const startTime = Date.now();

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      const latency = Date.now() - startTime;

      // 资源数防御性提取：响应体 JSON 中常见字段；取不到则不填（不造假数据）
      let resourceCount: number | undefined;
      try {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('json')) {
          const body = await res.json();
          if (typeof body.resourceCount === 'number') {
            resourceCount = body.resourceCount;
          } else if (Array.isArray(body.resources)) {
            resourceCount = body.resources.length;
          } else if (Array.isArray(body.data)) {
            resourceCount = body.data.length;
          }
        }
      } catch {
        // @ignore-catch: 响应非 JSON，resourceCount 留空（不造假数据）
      }

      return {
        serverUrl: url,
        // 收到任何 HTTP 响应即视为服务可达（MCP 端点可能对 GET 返回 405/404 但服务在线）
        isOnline: true,
        latency,
        resourceCount,
        lastCheckTime: Date.now(),
      };
    } catch (err) {
      // KB-MCP-PING-LOG（2026-08-29）：真实探测——超时/网络失败记录后判离线
      logger.warn('MCP 服务器探测失败', {
        serverUrl: url,
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        serverUrl: url,
        isOnline: false,
        latency: Date.now() - startTime,
        lastCheckTime: Date.now(),
      };
    } finally {
      clearTimeout(timer);
    }
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
