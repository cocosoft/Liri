/**
 * 监控任务
 *
 * 定期探测目标服务（MCP / API / WebSocket）的可用性，
 * 不可用时通过 TaskEvent 告警。
 * 参考 cc_code 的 MonitorMcpTask。
 */

import { EventEmitter } from 'events';
import { TaskType, TaskStatus } from './types';
import type { TaskState } from './types';
import { BaseTask } from './BaseTask';

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { DEFAULT_HTTP_PORT } from '@modules/core/ports';
const logger = getLogger('tasks:MonitorTask');

export interface MonitorTarget {
  name: string;
  url: string;
  checkIntervalMs: number;
  timeoutMs: number;
}

export const DEFAULT_MONITOR_TARGETS: MonitorTarget[] = [
  {
    name: 'mcp-server',
    url: `http://localhost:${DEFAULT_HTTP_PORT}/health`,
    checkIntervalMs: 30_000,
    timeoutMs: 5000,
  },
];

export class MonitorTask extends BaseTask {
  readonly type = TaskType.MONITOR_MCP;

  private targets: MonitorTarget[];
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastStatus: Map<string, boolean> = new Map();

  constructor(
    id: string,
    description: string,
    outputFile: string,
    targets: MonitorTarget[] = DEFAULT_MONITOR_TARGETS
  ) {
    super(id, description, outputFile, TaskType.MONITOR_MCP);
    this.targets = targets;
  }

  async spawn(): Promise<void> {
    this.setStatus(TaskStatus.RUNNING);
    for (const t of this.targets) {
      this.lastStatus.set(t.name, true);
    }

    this.timer = setInterval(async () => {
      for (const target of this.targets) {
        try {
          const ok = await this.checkTarget(target);
          const prevOk = this.lastStatus.get(target.name) ?? true;
          this.lastStatus.set(target.name, ok);

          if (ok && !prevOk) {
            this.writeOutput(
              `[${new Date().toISOString()}] ${target.name} 已恢复\n`
            );
            this.addActivity({
              toolName: 'monitor:recovery',
              input: { target: target.name },
              activityDescription: `${target.name} 已恢复可用`,
            });
          } else if (!ok && prevOk) {
            this.writeOutput(
              `[${new Date().toISOString()}] ${target.name} 不可用: ${target.url}\n`
            );
            this.addActivity({
              toolName: 'monitor:alert',
              input: { target: target.name },
              activityDescription: `${target.name} 不可用`,
            });
          } else if (!ok) {
            this.writeOutput(
              `[${new Date().toISOString()}] ${target.name} 持续不可用\n`
            );
          }
        } catch (err) {
          // 单目标探测失败不中断其他目标

          handleError(err, {
            module: 'tasks:monitor',
            action: 'probe',
          });
        }
      }
    }, 10_000); // 每 10s 检查一轮

    this.writeOutput(
      `[${new Date().toISOString()}] 监控已启动，共 ${this.targets.length} 个目标\n`
    );
  }

  async kill(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.setStatus(TaskStatus.COMPLETED);
  }

  private async checkTarget(target: MonitorTarget): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), target.timeoutMs);
      const res = await fetch(target.url, {
        signal: controller.signal,
        method: 'GET',
      });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  }
}
