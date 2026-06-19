/**
 * 沙箱管理�?
 * 提供沙箱环境，限制代码执行的权限和资�?
 */

import { logger } from '../utils/log.js';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

/**
 * 沙箱配置
 */
export interface SandboxConfig {
  /**
   * 允许的文件系统路�?
   */
  allowedPaths?: string[];
  /**
   * 禁止的文件系统路�?
   */
  forbiddenPaths?: string[];
  /**
   * 允许的网络主�?
   */
  allowedHosts?: string[];
  /**
   * 禁止的网络主�?
   */
  forbiddenHosts?: string[];
  /**
   * 最大执行时间（毫秒�?
   */
  maxExecutionTime?: number;
  /**
   * 最大内存使用（MB�?
   */
  maxMemory?: number;
  /**
   * 允许的环境变�?
   */
  allowedEnvVars?: string[];
  /**
   * 禁止的环境变�?
   */
  forbiddenEnvVars?: string[];
  /**
   * 允许的系统命�?
   */
  allowedCommands?: string[];
  /**
   * 禁止的系统命�?
   */
  forbiddenCommands?: string[];
}

/**
 * 沙箱状�?
 */
export enum SandboxState {
  /**
   * 未初始化
   */
  UNINITIALIZED = 'uninitialized',
  /**
   * 运行�?
   */
  RUNNING = 'running',
  /**
   * 已暂�?
   */
  PAUSED = 'paused',
  /**
   * 已停�?
   */
  STOPPED = 'stopped',
  /**
   * 错误
   */
  ERROR = 'error',
}

/**
 * 沙箱管理�?
 */
export class SandboxManager {
  private config: SandboxConfig;
  private state: SandboxState = SandboxState.UNINITIALIZED;
  private sandboxes: Map<string, any> = new Map();

  constructor(config: SandboxConfig = {}) {
    this.config = {
      allowedPaths: [],
      forbiddenPaths: [],
      allowedHosts: [],
      forbiddenHosts: [],
      maxExecutionTime: 30000,
      maxMemory: 128,
      allowedEnvVars: [],
      forbiddenEnvVars: [],
      allowedCommands: [],
      forbiddenCommands: [],
      ...config,
    };
  }

  /**
   * 初始化沙箱管理器
   */
  async init(): Promise<void> {
    try {
      logger.info('Initializing sandbox manager');
      this.state = SandboxState.RUNNING;
      logger.info('Sandbox manager initialized');
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to initialize sandbox manager:', e);
      this.state = SandboxState.ERROR;
      throw error;
    }
  }

  /**
   * 创建沙箱
   * @param id 沙箱ID
   * @param config 沙箱配置
   */
  createSandbox(id: string, config: SandboxConfig = {}): void {
    if (this.state !== SandboxState.RUNNING) {
      throw new AppError(
        'Sandbox manager is not running',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    if (this.sandboxes.has(id)) {
      throw new AppError(
        `Sandbox ${id} already exists`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const sandboxConfig = {
      ...this.config,
      ...config,
    };

    // 这里简化实现，实际应该创建真正的沙箱环�?
    const sandbox = {
      id,
      config: sandboxConfig,
      state: SandboxState.RUNNING,
      createdAt: new Date(),
    };

    this.sandboxes.set(id, sandbox);
    logger.info(`Created sandbox ${id}`);
  }

  /**
   * 销毁沙�?
   * @param id 沙箱ID
   */
  destroySandbox(id: string): void {
    if (this.sandboxes.has(id)) {
      this.sandboxes.delete(id);
      logger.info(`Destroyed sandbox ${id}`);
    } else {
      logger.warn(`Sandbox ${id} not found`);
    }
  }

  /**
   * 执行代码
   * @param id 沙箱ID
   * @param code 要执行的代码
   * @param context 执行上下�?
   */
  async execute(id: string, code: string, context: any = {}): Promise<unknown> {
    if (this.state !== SandboxState.RUNNING) {
      throw new AppError(
        'Sandbox manager is not running',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const sandbox = this.sandboxes.get(id);
    if (!sandbox) {
      throw new AppError(
        `Sandbox ${id} not found`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    try {
      logger.info(`Executing code in sandbox ${id}`);

      // 这里简化实现，实际应该在沙箱环境中执行代码
      // 模拟执行
      const result = eval(code);

      logger.info(`Code executed successfully in sandbox ${id}`);
      return result;
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      logger.error(`Failed to execute code in sandbox ${id}:`, e);
      throw error;
    }
  }

  /**
   * 检查文件系统访问权限
   * @param path 文件路径
   */
  checkFileSystemAccess(path: string): boolean {
    // 检查禁止的路径
    if (
      this.config.forbiddenPaths?.some((forbiddenPath) =>
        path.startsWith(forbiddenPath)
      )
    ) {
      return false;
    }

    // 检查允许的路径
    if (
      this.config.allowedPaths?.length &&
      !this.config.allowedPaths.some((allowedPath) =>
        path.startsWith(allowedPath)
      )
    ) {
      return false;
    }

    return true;
  }

  /**
   * 检查网络访问权�?
   * @param host 主机�?
   */
  checkNetworkAccess(host: string): boolean {
    // 检查禁止的主机
    if (this.config.forbiddenHosts?.includes(host)) {
      return false;
    }

    // 检查允许的主机
    if (
      this.config.allowedHosts?.length &&
      !this.config.allowedHosts.includes(host)
    ) {
      return false;
    }

    return true;
  }

  /**
   * 检查命令执行权�?
   * @param command 命令�?
   */
  checkCommandAccess(command: string): boolean {
    // 检查禁止的命令
    if (this.config.forbiddenCommands?.includes(command)) {
      return false;
    }

    // 检查允许的命令
    if (
      this.config.allowedCommands?.length &&
      !this.config.allowedCommands.includes(command)
    ) {
      return false;
    }

    return true;
  }

  /**
   * 检查环境变量访问权�?
   * @param envVar 环境变量�?
   */
  checkEnvironmentAccess(envVar: string): boolean {
    // 检查禁止的环境变量
    if (this.config.forbiddenEnvVars?.includes(envVar)) {
      return false;
    }

    // 检查允许的环境变量
    if (
      this.config.allowedEnvVars?.length &&
      !this.config.allowedEnvVars.includes(envVar)
    ) {
      return false;
    }

    return true;
  }

  /**
   * 获取沙箱状�?
   * @param id 沙箱ID
   */
  getSandboxState(id: string): SandboxState | undefined {
    const sandbox = this.sandboxes.get(id);
    return sandbox?.state;
  }

  /**
   * 获取所有沙�?
   */
  getSandboxes(): Map<string, any> {
    return this.sandboxes;
  }

  /**
   * 获取沙箱数量
   */
  getSandboxCount(): number {
    return this.sandboxes.size;
  }

  /**
   * 暂停沙箱
   * @param id 沙箱ID
   */
  pauseSandbox(id: string): void {
    const sandbox = this.sandboxes.get(id);
    if (sandbox) {
      sandbox.state = SandboxState.PAUSED;
      logger.info(`Paused sandbox ${id}`);
    }
  }

  /**
   * 恢复沙箱
   * @param id 沙箱ID
   */
  resumeSandbox(id: string): void {
    const sandbox = this.sandboxes.get(id);
    if (sandbox) {
      sandbox.state = SandboxState.RUNNING;
      logger.info(`Resumed sandbox ${id}`);
    }
  }

  /**
   * 停止沙箱管理�?
   */
  async stop(): Promise<void> {
    try {
      logger.info('Stopping sandbox manager');

      // 销毁所有沙�?
      for (const id of this.sandboxes.keys()) {
        this.destroySandbox(id);
      }

      this.state = SandboxState.STOPPED;
      logger.info('Sandbox manager stopped');
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to stop sandbox manager:', e);
      this.state = SandboxState.ERROR;
      throw error;
    }
  }

  /**
   * 获取沙箱管理器状态
   */
  getState(): SandboxState {
    return this.state;
  }

  /**
   * 获取沙箱配置
   */
  getConfig(): SandboxConfig {
    return this.config;
  }

  /**
   * 更新沙箱配置
   * @param config 新的配置
   */
  updateConfig(config: SandboxConfig): void {
    this.config = {
      ...this.config,
      ...config,
    };
    logger.info('Updated sandbox manager config');
  }
}

/**
 * 创建沙箱管理�?
 */
export function createSandboxManager(
  config: SandboxConfig = {}
): SandboxManager {
  return new SandboxManager(config);
}
