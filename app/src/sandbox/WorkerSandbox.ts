/**
 * Worker Threads 沙箱实现
 * 使用 Node.js worker_threads 实现进程级隔离
 * 插件代码在独立的 Worker 线程中执行，崩溃不影响主进程
 */

import { Worker } from 'worker_threads';
import { join } from 'path';
import { resolveProjectRoot } from '@modules/config/paths';
import {
  Sandbox,
  SandboxConfig,
  SandboxExecuteOptions,
  SandboxExecuteResult,
  SandboxPermission,
  SandboxPlatform,
} from './types/SandboxTypes';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * Worker 消息类型
 */
interface WorkerRequest {
  type: 'execute';
  requestId: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeout: number;
}

interface WorkerResponse {
  type: 'result' | 'error';
  requestId: string;
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  executionTime: number;
  error?: string;
}

/**
 * Worker 沙箱配置
 */
export interface WorkerSandboxConfig {
  /** Worker 超时时间（毫秒），默认 30000 */
  workerTimeoutMs: number;
  /** Worker 内存限制（MB），默认 256 */
  maxMemoryMB: number;
  /** Worker 脚本路径 */
  workerScript: string;
}

const DEFAULT_WORKER_CONFIG: WorkerSandboxConfig = {
  workerTimeoutMs: 30000,
  maxMemoryMB: 256,
  workerScript: '',
};

/**
 * Worker 沙箱实现
 * 使用 Node.js Worker Threads 提供进程级隔离
 */
export class WorkerSandbox implements Sandbox {
  protected config: SandboxConfig;
  private workerConfig: WorkerSandboxConfig;
  private worker: Worker | null = null;
  private isInitialized: boolean = false;
  private requestCounter: number = 0;
  private pendingRequests: Map<
    string,
    {
      resolve: (value: SandboxExecuteResult) => void;
      reject: (reason: Error) => void;
      timer: NodeJS.Timeout;
    }
  > = new Map();

  constructor(
    config: SandboxConfig,
    workerConfig?: Partial<WorkerSandboxConfig>
  ) {
    this.config = config;
    this.workerConfig = { ...DEFAULT_WORKER_CONFIG, ...workerConfig };
  }

  /**
   * 初始化 Worker 沙箱
   */
  async initialize(config: SandboxConfig): Promise<boolean> {
    this.config = config;
    try {
      this.worker = new Worker(this.resolveWorkerScript(), {
        workerData: {
          config: this.config,
          workerConfig: this.workerConfig,
        },
        resourceLimits: {
          maxOldGenerationSizeMb: this.workerConfig.maxMemoryMB,
        },
      });

      this.setupWorkerHandlers();
      this.isInitialized = true;
      logger.info(`WorkerSandbox initialized for platform ${config.platform}`);
      return true;
    } catch (error) {
      logger.error('Failed to initialize WorkerSandbox:', { error });
      this.isInitialized = false;
      return false;
    }
  }

  /**
   * 获取 Worker 脚本路径
   */
  private resolveWorkerScript(): string {
    if (this.workerConfig.workerScript) {
      return this.workerConfig.workerScript;
    }
    return join(
      resolveProjectRoot(),
      'app',
      'src',
      'sandbox',
      'worker-script.js'
    );
  }

  /**
   * 设置 Worker 消息处理器
   */
  private setupWorkerHandlers(): void {
    if (!this.worker) return;

    this.worker.on('message', (response: WorkerResponse) => {
      const pending = this.pendingRequests.get(response.requestId);
      if (!pending) return;

      clearTimeout(pending.timer);
      this.pendingRequests.delete(response.requestId);

      if (response.type === 'error') {
        pending.reject(new Error(response.error || 'Worker execution failed'));
        return;
      }

      pending.resolve({
        success: response.success,
        exitCode: response.exitCode,
        stdout: response.stdout,
        stderr: response.stderr,
        executionTime: response.executionTime,
        error: response.error,
      });
    });

    this.worker.on('error', (error) => {
      logger.error('Worker thread error:', { error });
      this.rejectAllPending(error);
    });

    this.worker.on('exit', (exitCode) => {
      logger.info(`Worker thread exited with code ${exitCode}`);
      if (exitCode !== 0) {
        const error = new Error(`Worker thread exited with code ${exitCode}`);
        this.rejectAllPending(error);
      }
      this.worker = null;
      this.isInitialized = false;
    });
  }

  /**
   * 拒绝所有待处理的请求
   */
  private rejectAllPending(error: Error): void {
    for (const [requestId, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  /**
   * 执行命令
   * 在独立的 Worker 线程中执行，实现进程级隔离
   */
  async execute(options: SandboxExecuteOptions): Promise<SandboxExecuteResult> {
    const startTime = Date.now();

    if (!this.isInitialized || !this.worker) {
      return {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: 'WorkerSandbox not initialized',
        executionTime: Date.now() - startTime,
        error: 'WorkerSandbox not initialized',
      };
    }

    const requestId = `req_${++this.requestCounter}_${Date.now()}`;

    const request: WorkerRequest = {
      type: 'execute',
      requestId,
      args: options.args,
      cwd: options.cwd,
      env: options.env,
      timeout: options.timeout || this.workerConfig.workerTimeoutMs,
    };

    return new Promise<SandboxExecuteResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        if (this.worker) {
          this.worker.terminate();
          this.worker = null;
          this.isInitialized = false;
          logger.warn(
            `WorkerSandbox request ${requestId} timed out, worker terminated`
          );
        }
        resolve({
          success: false,
          exitCode: 1,
          stdout: '',
          stderr: `Execution timed out after ${this.workerConfig.workerTimeoutMs}ms`,
          executionTime: Date.now() - startTime,
          error: `Execution timed out after ${this.workerConfig.workerTimeoutMs}ms`,
        });
      }, this.workerConfig.workerTimeoutMs);

      this.pendingRequests.set(requestId, { resolve, reject, timer });

      try {
        this.worker!.postMessage(request);
      } catch (error) {
        clearTimeout(timer);
        this.pendingRequests.delete(requestId);
        resolve({
          success: false,
          exitCode: 1,
          stdout: '',
          stderr: error instanceof Error ? error.message : String(error),
          executionTime: Date.now() - startTime,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  /**
   * 关闭沙箱
   */
  async close(): Promise<boolean> {
    if (this.worker) {
      this.rejectAllPending(new Error('WorkerSandbox closed'));
      await this.worker.terminate();
      this.worker = null;
    }
    this.isInitialized = false;
    logger.info('WorkerSandbox closed');
    return true;
  }

  /**
   * 获取沙箱状态
   */
  getStatus(): {
    isInitialized: boolean;
    platform: SandboxPlatform;
    config: SandboxConfig;
  } {
    return {
      isInitialized: this.isInitialized,
      platform: this.config.platform,
      config: this.config,
    };
  }

  /**
   * 检查权限
   */
  hasPermission(permission: SandboxPermission): boolean {
    return this.config.allowedPermissions.includes(permission);
  }

  /**
   * 添加文件系统白名单
   */
  addFilesystemWhitelist(path: string): boolean {
    if (!this.config.filesystemWhitelist.includes(path)) {
      this.config.filesystemWhitelist.push(path);
      return true;
    }
    return false;
  }

  /**
   * 添加网络访问白名单
   */
  addNetworkWhitelist(host: string): boolean {
    if (!this.config.networkWhitelist.includes(host)) {
      this.config.networkWhitelist.push(host);
      return true;
    }
    return false;
  }

  /**
   * 添加环境变量白名单
   */
  addEnvironmentWhitelist(envVar: string): boolean {
    if (!this.config.environmentWhitelist.includes(envVar)) {
      this.config.environmentWhitelist.push(envVar);
      return true;
    }
    return false;
  }
}
