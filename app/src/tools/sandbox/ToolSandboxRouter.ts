/**
 * 工具沙箱路由
 * E-08: 将高风险工具操作自动路由到 Docker 沙箱环境执行
 *
 * 风险分级:
 * - NONE: 无需沙箱隔离（只读工具、无副作用的查询）
 * - FILE_IO: 文件 I/O 操作（写入/修改文件）
 * - EXECUTION: 代码执行操作（shell 命令、脚本执行）
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import {
  SandboxManagerImpl,
  createSandboxManager,
} from '@modules/sandbox/SandboxImpl';
import {
  SandboxPlatform,
  SandboxPermission,
  createDefaultSandboxConfig,
  createSandboxExecuteOptions,
} from '@modules/sandbox/types/SandboxTypes';
import type {
  Sandbox,
  SandboxExecuteResult,
} from '@modules/sandbox/types/SandboxTypes';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 沙箱级别枚举
 */
export enum SandboxLevel {
  /** 无风险，不需要沙箱隔离 */
  NONE = 'none',
  /** 文件 I/O 操作，需文件读写沙箱 */
  FILE_IO = 'file-io',
  /** 代码执行操作，需完整 Docker 沙箱 */
  EXECUTION = 'execution',
}

/**
 * 高风险工具名称列表
 */
const HIGH_RISK_TOOLS = new Set(['bash', 'sh', 'shell', 'powershell', 'cmd']);

/**
 * 文件写入工具名称列表
 */
const FILE_WRITE_TOOLS = new Set([
  'file_write',
  'file_edit',
  'filewrite',
  'fileedit',
]);

/**
 * 工具沙箱路由
 * 提供统一的沙箱路由入口，按工具类型和输入自动路由到对应沙箱
 */
export class ToolSandboxRouter {
  private static sandboxManager: SandboxManagerImpl | null = null;

  /**
   * 获取沙箱管理器实例（懒加载单例）
   */
  private static getSandboxManager(): SandboxManagerImpl {
    if (!this.sandboxManager) {
      this.sandboxManager = createSandboxManager();
    }
    return this.sandboxManager;
  }

  /**
   * 根据工具名称和输入判断风险级别
   *
   * @param toolName 工具名称
   * @param input 工具输入（可选）
   * @returns 风险级别
   */
  static determineRiskLevel(
    toolName: string,
    input?: Record<string, unknown>
  ): SandboxLevel {
    const name = toolName.toLowerCase();

    if (HIGH_RISK_TOOLS.has(name)) {
      return SandboxLevel.EXECUTION;
    }

    if (FILE_WRITE_TOOLS.has(name)) {
      return SandboxLevel.FILE_IO;
    }

    return SandboxLevel.NONE;
  }

  /**
   * 判断指定工具操作是否应使用沙箱
   *
   * @param toolName 工具名称
   * @param input 工具输入（可选）
   * @returns 是否应使用沙箱
   */
  static shouldUseSandbox(
    toolName: string,
    input?: Record<string, unknown>
  ): boolean {
    const level = this.determineRiskLevel(toolName, input);
    const useSandbox = level !== SandboxLevel.NONE;
    logger.info(
      `[E-08] 沙箱路由决策: tool=${toolName}, level=${level}, sandbox=${useSandbox}`
    );
    return useSandbox;
  }

  /**
   * 在 Docker 沙箱中执行命令
   * 创建一次性 Docker 容器，执行命令后自动销毁
   *
   * @param command 要执行的命令
   * @param options 执行选项
   * @param options.cwd 工作目录
   * @param options.env 环境变量
   * @param options.timeout 超时时间（毫秒）
   * @returns 执行结果
   */
  static async executeInDockerSandbox(
    command: string,
    options: {
      cwd?: string;
      env?: Record<string, string>;
      timeout?: number;
    } = {}
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const manager = this.getSandboxManager();
    const platform = manager.getCurrentPlatform();
    const timeout = options.timeout || 30000;

    logger.info(`[E-08] Docker 沙箱执行命令: ${command.slice(0, 100)}`);

    const sandboxConfig = createDefaultSandboxConfig(platform, {
      allowedPermissions: [
        SandboxPermission.READ_FILE,
        SandboxPermission.WRITE_FILE,
        SandboxPermission.EXECUTE,
      ],
      maxExecutionTime: timeout,
      maxMemory: 512,
      customConfig: {
        dockerImage: 'node:24-alpine',
        dockerNetworkMode: 'none',
        dockerReadOnly: false,
        dockerMemoryLimit: '512m',
        dockerCpuLimit: '0.5',
      },
    });

    const sandbox: Sandbox = manager.createSandbox(sandboxConfig);
    const initialized = await sandbox.initialize(sandboxConfig);

    if (!initialized) {
      logger.warn('[E-08] Docker 沙箱初始化失败，回退到本地执行');
      return {
        stdout: '',
        stderr: 'Sandbox initialization failed',
        exitCode: -1,
      };
    }

    try {
      const executeOptions = createSandboxExecuteOptions(
        ['sh', '-c', command],
        {
          cwd: options.cwd,
          env: options.env,
          timeout,
        }
      );

      const result: SandboxExecuteResult =
        await sandbox.execute(executeOptions);

      logger.info(`[E-08] Docker 沙箱执行完成: exitCode=${result.exitCode}`);

      return {
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        exitCode: result.exitCode || 0,
      };
    } catch (error) {
      logger.error('[E-08] Docker 沙箱执行异常', error as Error);
      return {
        stdout: '',
        stderr:
          error instanceof Error ? error.message : 'Unknown sandbox error',
        exitCode: 1,
      };
    } finally {
      await sandbox.close();
    }
  }
}
