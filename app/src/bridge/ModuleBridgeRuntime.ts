/**
 * ModuleBridgeRuntime — ACP 模块桥接运行时
 *
 * 实现 AcpRuntime 接口，将 TaskRegistry、DaemonService、Chronos 等模块
 * 的操作封装为 ACP 可调用的命令，提供远程任务管理和模块状态查询能力。
 *
 * 命令格式（通过 runTurn 的 text 传入）:
 *   module:task/list        — 列出所有任务
 *   module:task/get <id>    — 查询指定任务
 *   module:task/count       — 获取任务统计
 *   module:task/kill <id>   — 终止指定任务
 *   module:daemon/status    — 获取守护进程状态
 *   module:daemon/action <action> — 执行守护进程操作 (start/stop/restart)
 *   module:chronos/status   — 获取定时调度器状态
 *   module:health           — 获取整体模块健康状态
 *   module:help             — 列出所有可用命令
 */

import type {
  AcpRuntime,
  AcpRuntimeHandle,
  AcpRuntimeEnsureInput,
  AcpRuntimeTurnInput,
  AcpRuntimeEvent,
  AcpRuntimeStatus,
  AcpRuntimeCapabilities,
  AcpRuntimeDoctorReport,
} from '@modules/acp/runtime/types.js';

import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';
const logger = new Logger({
  module: 'bridge:ModuleBridgeRuntime',
  level: LogLevel.INFO,
});

export interface ModuleBridgeDependencies {
  taskRegistry?: {
    getAllTaskInfos(): Array<{
      id: string;
      description: string;
      status: string;
      displayStatus: string;
      createdAt: number;
      metadata?: Record<string, unknown>;
    }>;
    getTaskInfo(taskId: string):
      | {
          id: string;
          description: string;
          status: string;
          displayStatus: string;
          createdAt: number;
          metadata?: Record<string, unknown>;
        }
      | undefined;
    getTaskCountByType(): Record<string, number>;
    getTaskCountByStatus(): Record<string, number>;
    kill(taskId: string): Promise<void>;
    getTaskCount(): number;
  };
  daemonService?: {
    getStatus(): { running: boolean; pid?: number; uptime?: number };
    execute(action: string): { success: boolean; message?: string };
  };
  chronosScheduler?: {
    isRunning(): boolean;
    getTaskCount(): number;
    getScheduledTasks(): Array<{
      id: string;
      cron: string;
      prompt: string;
      lastFiredAt?: number;
      createdAt: number;
    }>;
  };
}

interface ModuleCommand {
  name: string;
  description: string;
  usage: string;
  handler: (args: string[]) => Promise<AcpRuntimeEvent[]>;
}

export class ModuleBridgeRuntime implements AcpRuntime {
  private deps: ModuleBridgeDependencies;
  private commands: Map<string, ModuleCommand> = new Map();

  constructor(deps: ModuleBridgeDependencies) {
    this.deps = deps;
    this.registerCommands();
  }

  private registerCommands(): void {
    this.commands.set('module:help', {
      name: 'module:help',
      description: '列出所有可用模块命令',
      usage: 'module:help',
      handler: async () => this.handleHelp(),
    });

    this.commands.set('module:task/list', {
      name: 'module:task/list',
      description: '列出所有任务',
      usage: 'module:task/list',
      handler: async () => this.handleTaskList(),
    });

    this.commands.set('module:task/get', {
      name: 'module:task/get',
      description: '查询指定任务详情',
      usage: 'module:task/get <taskId>',
      handler: async (args) => this.handleTaskGet(args),
    });

    this.commands.set('module:task/count', {
      name: 'module:task/count',
      description: '获取任务统计',
      usage: 'module:task/count',
      handler: async () => this.handleTaskCount(),
    });

    this.commands.set('module:task/kill', {
      name: 'module:task/kill',
      description: '终止指定任务',
      usage: 'module:task/kill <taskId>',
      handler: async (args) => this.handleTaskKill(args),
    });

    this.commands.set('module:daemon/status', {
      name: 'module:daemon/status',
      description: '获取守护进程状态',
      usage: 'module:daemon/status',
      handler: async () => this.handleDaemonStatus(),
    });

    this.commands.set('module:daemon/action', {
      name: 'module:daemon/action',
      description: '执行守护进程操作 (start/stop/restart)',
      usage: 'module:daemon/action <start|stop|restart>',
      handler: async (args) => this.handleDaemonAction(args),
    });

    this.commands.set('module:chronos/status', {
      name: 'module:chronos/status',
      description: '获取定时调度器状态',
      usage: 'module:chronos/status',
      handler: async () => this.handleChronosStatus(),
    });

    this.commands.set('module:health', {
      name: 'module:health',
      description: '获取整体模块健康状态',
      usage: 'module:health',
      handler: async () => this.handleHealth(),
    });
  }

  async ensureSession(input: AcpRuntimeEnsureInput): Promise<AcpRuntimeHandle> {
    return {
      sessionKey: input.sessionKey,
      backend: 'module-bridge',
      runtimeSessionName: `module-${input.sessionKey}`,
      cwd: input.cwd,
    };
  }

  async *runTurn(input: AcpRuntimeTurnInput): AsyncIterable<AcpRuntimeEvent> {
    const text = input.text.trim();
    const parts = text.split(/\s+/);
    const commandName = parts[0]?.toLowerCase() || '';
    const args = parts.slice(1);

    const command = this.commands.get(commandName);

    if (command) {
      try {
        const resultEvents = await command.handler(args);
        for (const event of resultEvents) {
          yield event;
        }
      } catch (error) {
        void handleError(error, {
          module: 'bridge:runtime',
          action: 'runTurn',
        });
        yield {
          type: 'text_delta',
          text: `错误: ${error instanceof Error ? error.message : String(error)}`,
        };
        yield { type: 'done', stopReason: 'error' };
      }
    } else {
      yield {
        type: 'text_delta',
        text: `未知命令: ${commandName}。输入 module:help 查看可用命令。`,
      };
      yield { type: 'done', stopReason: 'error' };
    }
  }

  async cancel(input: {
    handle: AcpRuntimeHandle;
    reason?: string;
  }): Promise<void> {
    // 模块桥接操作无需取消，立即返回
  }

  async close(input: {
    handle: AcpRuntimeHandle;
    reason: string;
    discardPersistentState?: boolean;
  }): Promise<void> {
    // 模块桥接操作无需清理
  }

  getCapabilities(): AcpRuntimeCapabilities {
    return {
      supportsModes: false,
      supportsConfigOptions: false,
      supportsAttachments: false,
      maxPromptLength: 4096,
    };
  }

  async getStatus(): Promise<AcpRuntimeStatus> {
    const taskCount = this.deps.taskRegistry?.getTaskCount() ?? 0;
    return {
      connected: true,
      sessionActive: taskCount > 0,
      lastActivity: Date.now(),
    };
  }

  async doctor(): Promise<AcpRuntimeDoctorReport> {
    const checks: Array<{ name: string; passed: boolean; message?: string }> =
      [];

    checks.push({
      name: 'TaskRegistry',
      passed: !!this.deps.taskRegistry,
      message: this.deps.taskRegistry ? '已接入' : '未接入',
    });

    checks.push({
      name: 'DaemonService',
      passed: !!this.deps.daemonService,
      message: this.deps.daemonService ? '已接入' : '未接入',
    });

    checks.push({
      name: 'ChronosScheduler',
      passed: !!this.deps.chronosScheduler,
      message: this.deps.chronosScheduler ? '已接入' : '未接入',
    });

    const healthy = checks.every((c) => c.passed);
    return { healthy, checks };
  }

  private async handleHelp(): Promise<AcpRuntimeEvent[]> {
    const lines: string[] = ['可用模块命令:\n'];
    for (const [, cmd] of this.commands) {
      lines.push(`  ${cmd.usage.padEnd(40)} ${cmd.description}`);
    }
    lines.push('\n提示: 在 ACP 客户端的 prompt 中输入上述命令即可调用。');

    return [
      { type: 'text_delta', text: lines.join('\n') },
      { type: 'done', stopReason: 'success' },
    ];
  }

  private async handleTaskList(): Promise<AcpRuntimeEvent[]> {
    if (!this.deps.taskRegistry) {
      return [
        { type: 'text_delta', text: 'TaskRegistry 未接入。' },
        { type: 'done', stopReason: 'error' },
      ];
    }

    const tasks = this.deps.taskRegistry.getAllTaskInfos();
    if (tasks.length === 0) {
      return [
        { type: 'text_delta', text: '当前没有运行中的任务。' },
        { type: 'done', stopReason: 'success' },
      ];
    }

    const lines: string[] = [`任务列表 (共 ${tasks.length} 个):\n`];
    for (const task of tasks) {
      const desc = task.description.slice(0, 80);
      lines.push(
        `  [${task.displayStatus}] ${task.id}  ${desc}  (${new Date(task.createdAt).toISOString()})`
      );
    }

    return [
      { type: 'text_delta', text: lines.join('\n') },
      { type: 'done', stopReason: 'success' },
    ];
  }

  private async handleTaskGet(args: string[]): Promise<AcpRuntimeEvent[]> {
    if (!this.deps.taskRegistry) {
      return [
        { type: 'text_delta', text: 'TaskRegistry 未接入。' },
        { type: 'done', stopReason: 'error' },
      ];
    }

    const taskId = args[0];
    if (!taskId) {
      return [
        { type: 'text_delta', text: '用法: module:task/get <taskId>' },
        { type: 'done', stopReason: 'error' },
      ];
    }

    const task = this.deps.taskRegistry.getTaskInfo(taskId);
    if (!task) {
      return [
        { type: 'text_delta', text: `任务 ${taskId} 未找到。` },
        { type: 'done', stopReason: 'error' },
      ];
    }

    const lines: string[] = [
      `任务详情:\n`,
      `  ID:          ${task.id}`,
      `  描述:        ${task.description}`,
      `  状态:        ${task.status} (${task.displayStatus})`,
      `  创建时间:    ${new Date(task.createdAt).toISOString()}`,
    ];
    if (task.metadata) {
      lines.push(`  元数据:      ${JSON.stringify(task.metadata, null, 2)}`);
    }

    return [
      { type: 'text_delta', text: lines.join('\n') },
      { type: 'done', stopReason: 'success' },
    ];
  }

  private async handleTaskCount(): Promise<AcpRuntimeEvent[]> {
    if (!this.deps.taskRegistry) {
      return [
        { type: 'text_delta', text: 'TaskRegistry 未接入。' },
        { type: 'done', stopReason: 'error' },
      ];
    }

    const byType = this.deps.taskRegistry.getTaskCountByType();
    const byStatus = this.deps.taskRegistry.getTaskCountByStatus();

    const lines: string[] = ['任务统计:\n'];
    lines.push('  按类型:');
    for (const [type, count] of Object.entries(byType)) {
      lines.push(`    ${type}: ${count}`);
    }
    lines.push('  按状态:');
    for (const [status, count] of Object.entries(byStatus)) {
      lines.push(`    ${status}: ${count}`);
    }
    lines.push(`\n  总计: ${this.deps.taskRegistry.getTaskCount()}`);

    return [
      { type: 'text_delta', text: lines.join('\n') },
      { type: 'done', stopReason: 'success' },
    ];
  }

  private async handleTaskKill(args: string[]): Promise<AcpRuntimeEvent[]> {
    if (!this.deps.taskRegistry) {
      return [
        { type: 'text_delta', text: 'TaskRegistry 未接入。' },
        { type: 'done', stopReason: 'error' },
      ];
    }

    const taskId = args[0];
    if (!taskId) {
      return [
        { type: 'text_delta', text: '用法: module:task/kill <taskId>' },
        { type: 'done', stopReason: 'error' },
      ];
    }

    await this.deps.taskRegistry.kill(taskId);

    return [
      { type: 'text_delta', text: `任务 ${taskId} 已终止。` },
      { type: 'done', stopReason: 'success' },
    ];
  }

  private async handleDaemonStatus(): Promise<AcpRuntimeEvent[]> {
    if (!this.deps.daemonService) {
      return [
        { type: 'text_delta', text: 'DaemonService 未接入。' },
        { type: 'done', stopReason: 'error' },
      ];
    }

    const status = this.deps.daemonService.getStatus();
    const lines: string[] = [
      '守护进程状态:\n',
      `  运行中:  ${status.running ? '是' : '否'}`,
    ];
    if (status.pid) {
      lines.push(`  PID:     ${status.pid}`);
    }
    if (status.uptime) {
      lines.push(`  运行时长: ${Math.floor(status.uptime / 1000)}秒`);
    }

    return [
      { type: 'text_delta', text: lines.join('\n') },
      { type: 'done', stopReason: 'success' },
    ];
  }

  private async handleDaemonAction(args: string[]): Promise<AcpRuntimeEvent[]> {
    if (!this.deps.daemonService) {
      return [
        { type: 'text_delta', text: 'DaemonService 未接入。' },
        { type: 'done', stopReason: 'error' },
      ];
    }

    const action = args[0];
    if (!action || !['start', 'stop', 'restart'].includes(action)) {
      return [
        {
          type: 'text_delta',
          text: '用法: module:daemon/action <start|stop|restart>',
        },
        { type: 'done', stopReason: 'error' },
      ];
    }

    const result = this.deps.daemonService.execute(action);
    if (result.success) {
      return [
        { type: 'text_delta', text: `守护进程 ${action} 操作成功。` },
        { type: 'done', stopReason: 'success' },
      ];
    }

    return [
      {
        type: 'text_delta',
        text: `守护进程 ${action} 操作失败: ${result.message || '未知错误'}`,
      },
      { type: 'done', stopReason: 'error' },
    ];
  }

  private async handleChronosStatus(): Promise<AcpRuntimeEvent[]> {
    if (!this.deps.chronosScheduler) {
      return [
        { type: 'text_delta', text: 'ChronosScheduler 未接入。' },
        { type: 'done', stopReason: 'error' },
      ];
    }

    const running = this.deps.chronosScheduler.isRunning();
    const taskCount = this.deps.chronosScheduler.getTaskCount();
    const tasks = this.deps.chronosScheduler.getScheduledTasks();

    const lines: string[] = [
      '定时调度器状态:\n',
      `  运行中:     ${running ? '是' : '否'}`,
      `  任务数:     ${taskCount}\n`,
    ];

    if (tasks.length > 0) {
      lines.push('  调度任务:');
      for (const task of tasks) {
        const lastFire = task.lastFiredAt
          ? new Date(task.lastFiredAt).toISOString()
          : '从未执行';
        lines.push(
          `    [${task.id}] ${task.cron}  "${task.prompt.slice(0, 60)}"  上次执行: ${lastFire}`
        );
      }
    }

    return [
      { type: 'text_delta', text: lines.join('\n') },
      { type: 'done', stopReason: 'success' },
    ];
  }

  private async handleHealth(): Promise<AcpRuntimeEvent[]> {
    const doctor = await this.doctor();
    const lines: string[] = [
      '模块健康检查:\n',
      `  整体状态: ${doctor.healthy ? '健康' : '异常'}\n`,
    ];

    for (const check of doctor.checks) {
      lines.push(
        `  [${check.passed ? '✓' : '✗'}] ${check.name}: ${check.message || (check.passed ? '正常' : '异常')}`
      );
    }

    const summary: string[] = [];
    if (this.deps.taskRegistry) {
      summary.push(`任务: ${this.deps.taskRegistry.getTaskCount()} 个`);
    }
    if (this.deps.daemonService) {
      const status = this.deps.daemonService.getStatus();
      summary.push(`守护进程: ${status.running ? '运行中' : '已停止'}`);
    }
    if (this.deps.chronosScheduler) {
      summary.push(
        `调度器: ${this.deps.chronosScheduler.isRunning() ? '运行中' : '已停止'} (${this.deps.chronosScheduler.getTaskCount()} 个任务)`
      );
    }

    if (summary.length > 0) {
      lines.push('\n  概要:');
      lines.push(`    ${summary.join(' | ')}`);
    }

    return [
      { type: 'text_delta', text: lines.join('\n') },
      { type: 'done', stopReason: 'success' },
    ];
  }
}

let defaultModuleBridge: ModuleBridgeRuntime | null = null;

export function getDefaultModuleBridge(): ModuleBridgeRuntime | null {
  return defaultModuleBridge;
}

export function setDefaultModuleBridge(bridge: ModuleBridgeRuntime): void {
  defaultModuleBridge = bridge;
}

export function resetDefaultModuleBridge(): void {
  defaultModuleBridge = null;
}
