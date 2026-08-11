/**
 * 本地Bash任务
 * 支持卡死检测（stall watchdog）、提示检测（prompt detection）、前后台管理
 */

import { spawn, ChildProcess } from 'child_process';
import { createWriteStream, WriteStream } from 'fs';
import { stat } from 'fs/promises';
import type {
  BashTaskKind,
  LocalShellTaskState,
} from './LocalShellTask/guards';
import { isLocalShellTask } from './LocalShellTask/guards';
import { BaseTask } from './BaseTask';
import { TaskType, TaskStatus } from './types';
import type { TaskState } from './types';
import type { BashTaskOptions } from './types';
import { taskRegistry } from './TaskRegistry';

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
const logger = getLogger('tasks:LocalBashTask');

/** 卡死检测间隔（毫秒） */
const STALL_CHECK_INTERVAL_MS = 5_000;

/** 卡死判定阈值：输出停止增长超过此时间（毫秒）即判定为卡死 */
const STALL_THRESHOLD_MS = 45_000;

/** 卡死检测时读取的尾部字节数 */
const STALL_TAIL_BYTES = 1024;

/**
 * 交互式提示检测模式
 * 用于判断命令行输出末尾是否看起来像等待用户输入的交互式提示
 */
const PROMPT_PATTERNS: RegExp[] = [
  /\(y\/n\)/i,
  /\[y\/n\]/i,
  /\(yes\/no\)/i,
  /\b(?:Do you|Would you|Shall I|Are you sure|Ready to)\b.*\? *$/i,
  /Press (any key|Enter)/i,
  /Continue\?/i,
  /Overwrite\?/i,
];

/**
 * 判断输出末尾是否像交互式提示
 * @param tail 输出尾部内容
 * @returns 是否匹配提示模式
 */
export function looksLikePrompt(tail: string): boolean {
  const lastLine = tail.trimEnd().split('\n').pop() ?? '';
  return PROMPT_PATTERNS.some((p) => p.test(lastLine));
}

/**
 * LocalBashTask 选项
 * 继承 BashTaskOptions 并添加管理相关字段
 */
export interface LocalBashTaskOptions extends BashTaskOptions {
  /** 任务种类：bash（普通命令）/ monitor（监控） */
  kind?: BashTaskKind;
  /** 关联的 agent 标识 */
  agentId?: string;
  /** 是否后台运行 */
  isBackgrounded?: boolean;
  /** 工具使用 ID */
  toolUseId?: string;
}

/**
 * 本地Bash任务
 * 支持卡死检测、提示检测、前后台管理等高级功能
 */
export class LocalBashTask extends BaseTask {
  readonly type = TaskType.LOCAL_BASH;

  private options: LocalBashTaskOptions;
  private subprocess?: ChildProcess;
  private outputStream?: WriteStream;
  private stdoutBuffer = '';
  private stderrBuffer = '';
  private stallWatchdogTimer?: ReturnType<typeof setInterval>;
  private _isBackgrounded: boolean;
  private _kind: BashTaskKind;
  private _agentId?: string;
  private _result?: { code: number; interrupted: boolean };
  private _completionStatusSent = false;

  constructor(id: string, outputFile: string, options: LocalBashTaskOptions) {
    const description = options.description || options.command;
    super(id, description, outputFile, TaskType.LOCAL_BASH);
    this.options = options;
    this._isBackgrounded = options.isBackgrounded ?? false;
    this._kind = options.kind ?? 'bash';
    this._agentId = options.agentId;
  }

  /** 是否已后台化 */
  get isBackgrounded(): boolean {
    return this._isBackgrounded;
  }

  /** 任务种类 */
  get bashKind(): BashTaskKind {
    return this._kind;
  }

  /** 关联 agent ID */
  get agentId(): string | undefined {
    return this._agentId;
  }

  /** 执行结果 */
  get bashResult(): { code: number; interrupted: boolean } | undefined {
    return this._result;
  }

  /** 获取增强状态（含 bash 特有字段） */
  getEnhancedState(): LocalShellTaskState {
    return {
      ...this.taskState,
      type: TaskType.LOCAL_BASH,
      command: this.options.command,
      isBackgrounded: this._isBackgrounded,
      kind: this._kind,
      agentId: this._agentId,
      result: this._result,
      completionStatusSentInAttachment: this._completionStatusSent,
      shellCommand: null,
      lastReportedTotalLines: 0,
    };
  }

  /**
   * 后台化此任务
   * 标记为后台运行，启动卡死检测
   * @returns 是否成功后台化
   */
  background(): boolean {
    if (this._isBackgrounded) return false;

    this._isBackgrounded = true;
    this.startStallWatchdog();
    this.emit('backgrounded', { taskId: this.id });
    return true;
  }

  /**
   * 标记任务已通知
   * 用于抑制重复通知
   */
  markNotified(): void {
    this._completionStatusSent = true;
    this.updateState({ notified: true });
  }

  /**
   * 启动卡死检测定时器
   * 定时检查输出文件是否停止增长，若停止且尾部看起来像交互式提示则发出 'stalled' 事件
   */
  private startStallWatchdog(): void {
    if (this._kind === 'monitor') return;

    let lastSize = 0;
    let lastGrowth = Date.now();
    this.stallWatchdogTimer = setInterval(async () => {
      try {
        logger.debug('Bash 卡死检测 tick', { taskId: this.id });
        const filePath = this.state.outputFile;
        if (!filePath) return;

        const s = await stat(filePath);

        if (s.size > lastSize) {
          lastSize = s.size;
          lastGrowth = Date.now();
          return;
        }

        if (Date.now() - lastGrowth < STALL_THRESHOLD_MS) return;

        const combinedOutput = this.stdoutBuffer + this.stderrBuffer;
        const tail = combinedOutput.slice(-STALL_TAIL_BYTES);
        if (!looksLikePrompt(tail)) {
          lastGrowth = Date.now();
          return;
        }

        this.stopStallWatchdog();
        logger.warn('Bash 任务疑似卡死，发出 stalled 事件', { taskId: this.id });
        this.emit('stalled', {
          taskId: this.id,
          description: this.state.description,
          tail,
        });
      } catch (err) {
        // 输出文件可能还不存在
        logger.debug('Bash 卡死检测失败（输出文件可能不存在）', { error: err });

        handleError(err, {
          module: 'tasks:bash',
          action: 'stallCheck',
        });
      }
    }, STALL_CHECK_INTERVAL_MS);

    if (
      this.stallWatchdogTimer &&
      typeof this.stallWatchdogTimer === 'object' &&
      'unref' in this.stallWatchdogTimer
    ) {
      this.stallWatchdogTimer.unref();
    }
  }

  /**
   * 停止卡死检测定时器
   */
  private stopStallWatchdog(): void {
    if (this.stallWatchdogTimer) {
      clearInterval(this.stallWatchdogTimer);
      this.stallWatchdogTimer = undefined;
    }
  }

  async spawn(): Promise<void> {
    this.setStatus(TaskStatus.RUNNING);

    const filePath = this.state.outputFile;
    if (filePath) {
      this.outputStream = createWriteStream(filePath, { flags: 'w' });
    }

    return new Promise((resolve, reject) => {
      const signal = this.getAbortSignal();

      if (signal.aborted) {
        this.setStatus(TaskStatus.KILLED);
        this.outputStream?.end();
        reject(new Error('Task was aborted before starting'));
        return;
      }

      signal.addEventListener('abort', () => {
        if (this.subprocess && !this.subprocess.killed) {
          this.subprocess.kill('SIGTERM');
        }
      });

      this.subprocess = spawn(this.options.command, [], {
        cwd: this.options.cwd,
        env: { ...process.env, ...this.options.env },
        shell: true,
        signal: this.abortController.signal,
      });

      this.subprocess.stdout?.on('data', (data: Buffer) => {
        const output = data.toString();
        this.stdoutBuffer += output;
        this.outputStream?.write(output);
        this.emit('output', { type: 'stdout', data: output });
        // P2-8: 逐行馈入 WatchdogBridge 检测异常模式
        this.feedWatchdog(output);
      });

      this.subprocess.stderr?.on('data', (data: Buffer) => {
        const output = data.toString();
        this.stderrBuffer += output;
        this.outputStream?.write(output);
        this.emit('output', { type: 'stderr', data: output });
        // P2-8: 逐行馈入 WatchdogBridge 检测异常模式
        this.feedWatchdog(output);
      });

      const cleanup = () => {
        this.outputStream?.end();
        this.outputStream = undefined;
      };

      this.subprocess.on('exit', (code: number | null, sig: string | null) => {
        this.stopStallWatchdog();
        cleanup();

        this._result = {
          code: code ?? -1,
          interrupted: sig === 'SIGTERM' || this.abortController.signal.aborted,
        };

        if (sig === 'SIGTERM' || this.abortController.signal.aborted) {
          this.setStatus(TaskStatus.KILLED);
          this.emit('bashExited', {
            taskId: this.id,
            status: 'killed',
            result: this._result,
          });
          reject(new Error('Task was killed'));
        } else if (code === 0) {
          this.setStatus(TaskStatus.COMPLETED);
          this.emit('bashExited', {
            taskId: this.id,
            status: 'completed',
            result: this._result,
          });
          resolve();
        } else {
          const errorMsg =
            code !== null
              ? `Command exited with code ${code}`
              : `Command terminated by signal ${sig}`;
          this.setStatus(TaskStatus.FAILED, errorMsg);
          this.emit('bashExited', {
            taskId: this.id,
            status: 'failed',
            result: this._result,
            error: errorMsg,
          });
          reject(new Error(errorMsg));
        }
      });

      this.subprocess.on('error', (error: Error) => {
        this.stopStallWatchdog();
        cleanup();
        this.setStatus(TaskStatus.FAILED, error.message);
        reject(error);
      });

      if (this.options.timeout) {
        setTimeout(() => {
          this.kill();
          reject(
            new Error(`Command timed out after ${this.options.timeout}ms`)
          );
        }, this.options.timeout);
      }

      if (!this._isBackgrounded) {
        this.startStallWatchdog();
      }
    });
  }

  /**
   * P2-8: 逐行馈入 WatchdogBridge 检测异常模式（OOM/磁盘满/认证失败/限流/断连）
   */
  private feedWatchdog(output: string): void {
    const lines = output.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      import('./watchdog/WatchdogBridge')
        .then(({ getWatchdogBridge }) => {
          getWatchdogBridge().feed(trimmed);
        })
        .catch(() => {
          // watchdog feed 失败不阻断主流程
        });
    }
  }

  async kill(): Promise<void> {
    this.stopStallWatchdog();
    this.abortController.abort();

    if (this.subprocess && !this.subprocess.killed) {
      this.subprocess.kill('SIGTERM');

      await new Promise<void>((resolve) => {
        setTimeout(() => {
          if (!this.subprocess?.killed) {
            this.subprocess?.kill('SIGKILL');
          }
          resolve();
        }, 1000);
      });
    }

    this.outputStream?.end();
    this.outputStream = undefined;

    this._result = {
      code: -1,
      interrupted: true,
    };
    this.setStatus(TaskStatus.KILLED);
  }

  /**
   * 创建并注册一个前台 Bash 任务
   * 该任务后续可能被后台化
   * @param options 任务选项
   * @returns 任务ID
   */
  static registerForeground(options: LocalBashTaskOptions): string {
    const id = taskRegistry.generateTaskId(TaskType.LOCAL_BASH);
    const outputFile = `bash_${id}_output.log`;
    const task = new LocalBashTask(id, outputFile, {
      ...options,
      isBackgrounded: false,
    });
    taskRegistry.register(task);
    return id;
  }

  /**
   * 取消注册前台任务
   * 只有当任务尚未被后台化时才移除
   * @param taskId 任务ID
   */
  static unregisterForeground(taskId: string): void {
    const task = taskRegistry.getTask<LocalBashTask>(taskId);
    if (!task || !(task instanceof LocalBashTask)) return;

    taskRegistry.remove(taskId);
  }

  /**
   * 后台化所有前台 Bash 任务
   * 遍历注册表中的所有 LocalBashTask，将未后台化的标记为后台
   */
  static backgroundAll(): void {
    const tasks = taskRegistry.getTaskByType(TaskType.LOCAL_BASH);

    for (const task of tasks) {
      if (task instanceof LocalBashTask && !task._isBackgrounded) {
        task.background();
      }
    }
  }

  /**
   * 检查是否存在可后台化的前台任务
   * @returns 是否存在前台任务
   */
  static hasForegroundTasks(): boolean {
    const tasks = taskRegistry.getTaskByType(TaskType.LOCAL_BASH);

    return tasks.some((task) => {
      if (!(task instanceof LocalBashTask)) return false;
      const state = task.taskState;
      return (
        task._isBackgrounded === false && state.status === TaskStatus.RUNNING
      );
    });
  }
}

export default LocalBashTask;
