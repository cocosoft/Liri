/**
 * 沙箱实现类
 * 包含不同平台的沙箱实现
 */

import {
  Sandbox,
  SandboxConfig,
  SandboxExecuteOptions,
  SandboxExecuteResult,
  SandboxPermission,
  SandboxPermissions,
  SandboxPlatform,
} from './SandboxTypes';
import { SandboxConfigBuilder } from './SandboxConfigBuilder';
import { execSync, exec } from 'child_process';
import { promisify } from 'util';

import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';
const logger = new Logger({
  module: 'sandbox:SandboxImpl',
  level: LogLevel.INFO,
});

const execAsync = promisify(exec);

/**
 * 基础沙箱类
 */
export abstract class BaseSandbox implements Sandbox {
  /** 沙箱配置 */
  protected config: SandboxConfig;
  /** 是否已初始化 */
  protected isInitialized: boolean = false;

  /**
   * 构造函数
   * @param config 沙箱配置
   */
  constructor(config: SandboxConfig) {
    this.config = config;
  }

  /**
   * 初始化沙箱
   * @param config 沙箱配置
   * @returns 初始化结果
   */
  async initialize(config: SandboxConfig): Promise<boolean> {
    this.config = config;
    this.isInitialized = true;
    return true;
  }

  /**
   * 执行命令
   * @param options 执行选项
   * @returns 执行结果
   */
  abstract execute(
    options: SandboxExecuteOptions
  ): Promise<SandboxExecuteResult>;

  /**
   * 关闭沙箱
   * @returns 关闭结果
   */
  async close(): Promise<boolean> {
    this.isInitialized = false;
    return true;
  }

  /**
   * 获取沙箱状态
   * @returns 沙箱状态
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
   * @param permission 权限类型
   * @returns 是否拥有权限
   */
  hasPermission(permission: SandboxPermission): boolean {
    return this.config.allowedPermissions.includes(permission);
  }

  /**
   * 添加文件系统白名单
   * @param path 文件路径
   * @returns 添加结果
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
   * @param host 主机名或IP
   * @returns 添加结果
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
   * @param envVar 环境变量名
   * @returns 添加结果
   */
  addEnvironmentWhitelist(envVar: string): boolean {
    if (!this.config.environmentWhitelist.includes(envVar)) {
      this.config.environmentWhitelist.push(envVar);
      return true;
    }
    return false;
  }
}

/**
 * Windows 沙箱实现
 * 使用 PowerShell 约束模式
 */
export class WindowsSandbox extends BaseSandbox {
  /**
   * 执行命令
   * @param options 执行选项
   * @returns 执行结果
   */
  async execute(options: SandboxExecuteOptions): Promise<SandboxExecuteResult> {
    const startTime = Date.now();

    try {
      // 构建 PowerShell 命令
      const args = options.args
        .map((arg) => `"${arg.replace(/"/g, '\"')}"`)
        .join(' ');
      const powershellCommand = `powershell -ExecutionPolicy Restricted -Command "& { ${args} }"`;

      // 执行命令
      const { stdout, stderr } = await execAsync(powershellCommand, {
        cwd: options.cwd,
        env: options.env,
        timeout: options.timeout,
      });

      return {
        success: true,
        exitCode: 0,
        stdout,
        stderr,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      void handleError(error, {
        module: 'sandbox:impl',
        action: 'WindowsSandbox.execute',
      });
      const execErr = error as {
        code?: number;
        stdout?: string;
        stderr?: string;
        message?: string;
      };
      return {
        success: false,
        exitCode: execErr.code || 1,
        stdout: execErr.stdout || '',
        stderr: execErr.stderr || execErr.message || '',
        executionTime: Date.now() - startTime,
        error: execErr.message || String(error),
      };
    }
  }
}

/**
 * Linux 沙箱实现
 * 使用 bubblewrap + seccomp
 */
export class LinuxSandbox extends BaseSandbox {
  /**
   * 执行命令
   * @param options 执行选项
   * @returns 执行结果
   */
  async execute(options: SandboxExecuteOptions): Promise<SandboxExecuteResult> {
    const startTime = Date.now();

    try {
      // 检查 bubblewrap 是否安装
      try {
        execSync('which bwrap', { stdio: 'ignore' });
      } catch {
        void handleError(new Error('bubblewrap 未安装'), {
          module: 'sandbox:impl',
          action: 'LinuxSandbox.checkBwrap',
        });
        return {
          success: false,
          exitCode: 1,
          stdout: '',
          stderr: 'bubblewrap is not installed',
          executionTime: Date.now() - startTime,
          error: 'bubblewrap is not installed',
        };
      }

      // 根据配置构建精细权限
      let permissions: SandboxPermissions;
      const toolType = options.args[0] || '';
      if (this.config.allowedPermissions.length > 0) {
        permissions = SandboxConfigBuilder.fromToolType(toolType, options.cwd);
      } else {
        permissions = SandboxConfigBuilder.defaultTool();
      }

      // 构建 bubblewrap 命令（精细容器隔离）
      const bwrapArgs: string[] = ['bwrap'];

      // 命名空间隔离
      bwrapArgs.push('--unshare-all');

      // 只读系统路径（替代 --ro-bind / /）
      bwrapArgs.push('--ro-bind', '/usr', '/usr');
      bwrapArgs.push('--ro-bind', '/lib', '/lib');
      bwrapArgs.push('--ro-bind', '/lib64', '/lib64');

      // 空临时目录
      bwrapArgs.push('--tmpfs', '/tmp');
      bwrapArgs.push('--tmpfs', '/var/tmp');
      bwrapArgs.push('--tmpfs', '/home');
      bwrapArgs.push('--tmpfs', '/root');

      // 虚拟文件系统
      bwrapArgs.push('--proc', '/proc');
      bwrapArgs.push('--dev', '/dev');

      // 文件系统白名单（基于精细权限）
      for (const fsRule of permissions.filesystem) {
        const flag = fsRule.permissions.includes('write')
          ? '--bind'
          : '--ro-bind';
        bwrapArgs.push(flag, fsRule.path, fsRule.path);
      }

      // 兼容旧配置的 filesystemWhitelist
      for (const path of this.config.filesystemWhitelist) {
        if (!permissions.filesystem.some((r) => r.path === path)) {
          bwrapArgs.push('--bind', path, path);
        }
      }

      // 网络隔离
      if (!permissions.network) {
        bwrapArgs.push('--unshare-net');
      }

      // 进程隔离
      if (!permissions.process) {
        bwrapArgs.push('--unshare-pid');
      }

      // 安全参数
      bwrapArgs.push('--die-with-parent');
      bwrapArgs.push('--setenv', 'PATH', '/usr/bin:/bin');
      bwrapArgs.push('--setenv', 'HOME', '/tmp');

      // 添加命令参数
      bwrapArgs.push(...options.args);

      // 执行命令
      const { stdout, stderr } = await execAsync(bwrapArgs.join(' '), {
        cwd: options.cwd,
        env: options.env,
        timeout: options.timeout || permissions.timeoutMs,
      });

      return {
        success: true,
        exitCode: 0,
        stdout,
        stderr,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      void handleError(error, {
        module: 'sandbox:impl',
        action: 'LinuxSandbox.execute',
      });
      const execErr = error as {
        code?: number;
        stdout?: string;
        stderr?: string;
        message?: string;
      };
      return {
        success: false,
        exitCode: execErr.code || 1,
        stdout: execErr.stdout || '',
        stderr: execErr.stderr || execErr.message || '',
        executionTime: Date.now() - startTime,
        error: execErr.message || String(error),
      };
    }
  }
}

/**
 * macOS 沙箱实现
 * 使用 sandbox-exec
 */
export class MacOSSandbox extends BaseSandbox {
  /**
   * 执行命令
   * @param options 执行选项
   * @returns 执行结果
   */
  async execute(options: SandboxExecuteOptions): Promise<SandboxExecuteResult> {
    const startTime = Date.now();

    try {
      // 构建 sandbox-exec 配置
      const sandboxProfile = `(
        (version 1)
        (deny default)
        (allow file-read*)
        (allow process-exec)
        (allow network*)
      )`;

      // 构建命令
      const args = options.args
        .map((arg) => `"${arg.replace(/"/g, '\"')}"`)
        .join(' ');
      const sandboxCommand = `sandbox-exec -p '${sandboxProfile}' bash -c "${args}"`;

      // 执行命令
      const { stdout, stderr } = await execAsync(sandboxCommand, {
        cwd: options.cwd,
        env: options.env,
        timeout: options.timeout,
      });

      return {
        success: true,
        exitCode: 0,
        stdout,
        stderr,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      void handleError(error, {
        module: 'sandbox:impl',
        action: 'MacOSSandbox.execute',
      });
      const execErr = error as {
        code?: number;
        stdout?: string;
        stderr?: string;
        message?: string;
      };
      return {
        success: false,
        exitCode: execErr.code || 1,
        stdout: execErr.stdout || '',
        stderr: execErr.stderr || execErr.message || '',
        executionTime: Date.now() - startTime,
        error: execErr.message || String(error),
      };
    }
  }
}

/**
 * 无操作沙箱实现
 * 用于不支持沙箱的平台
 */
export class NoopSandbox extends BaseSandbox {
  /**
   * 执行命令
   * @param options 执行选项
   * @returns 执行结果
   */
  async execute(options: SandboxExecuteOptions): Promise<SandboxExecuteResult> {
    const startTime = Date.now();

    try {
      // 直接执行命令
      const args = options.args
        .map((arg) => `"${arg.replace(/"/g, '\"')}"`)
        .join(' ');
      const { stdout, stderr } = await execAsync(args, {
        cwd: options.cwd,
        env: options.env,
        timeout: options.timeout,
      });

      return {
        success: true,
        exitCode: 0,
        stdout,
        stderr,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      void handleError(error, {
        module: 'sandbox:impl',
        action: 'NoopSandbox.execute',
      });
      const execErr = error as {
        code?: number;
        stdout?: string;
        stderr?: string;
        message?: string;
      };
      return {
        success: false,
        exitCode: execErr.code || 1,
        stdout: execErr.stdout || '',
        stderr: execErr.stderr || execErr.message || '',
        executionTime: Date.now() - startTime,
        error: execErr.message || String(error),
      };
    }
  }
}

/**
 * 沙箱管理器实现
 */
export class SandboxManagerImpl {
  /**
   * 创建沙箱实例
   * @param config 沙箱配置
   * @returns 沙箱实例
   */
  createSandbox(config: SandboxConfig): Sandbox {
    // 检测 Docker 沙箱配置（通过 customConfig 中是否包含 dockerImage 键）
    if (config.customConfig?.['dockerImage']) {
      const { DockerSandbox } = require('./docker/DockerSandbox');
      return new DockerSandbox();
    }
    switch (config.platform) {
      case SandboxPlatform.WINDOWS:
        return new WindowsSandbox(config);
      case SandboxPlatform.LINUX:
        return new LinuxSandbox(config);
      case SandboxPlatform.MACOS:
        return new MacOSSandbox(config);
      default:
        return new NoopSandbox(config);
    }
  }

  /**
   * 获取当前平台
   * @returns 平台类型
   */
  getCurrentPlatform(): SandboxPlatform {
    const platform = process.platform;
    switch (platform) {
      case 'win32':
        return SandboxPlatform.WINDOWS;
      case 'linux':
        return SandboxPlatform.LINUX;
      case 'darwin':
        return SandboxPlatform.MACOS;
      default:
        return SandboxPlatform.UNKNOWN;
    }
  }

  /**
   * 检查平台是否支持
   * @param platform 平台类型
   * @returns 是否支持
   */
  isPlatformSupported(platform: SandboxPlatform): boolean {
    return platform !== SandboxPlatform.UNKNOWN;
  }

  /**
   * 获取平台支持的权限列表
   * @param platform 平台类型
   * @returns 支持的权限列表
   */
  getSupportedPermissions(platform: SandboxPlatform): SandboxPermission[] {
    // 不同平台支持的权限
    const permissions: Record<SandboxPlatform, SandboxPermission[]> = {
      [SandboxPlatform.WINDOWS]: [
        SandboxPermission.READ_FILE,
        SandboxPermission.WRITE_FILE,
        SandboxPermission.EXECUTE,
        SandboxPermission.NETWORK,
        SandboxPermission.ENVIRONMENT,
      ],
      [SandboxPlatform.LINUX]: [
        SandboxPermission.READ_FILE,
        SandboxPermission.WRITE_FILE,
        SandboxPermission.EXECUTE,
        SandboxPermission.NETWORK,
        SandboxPermission.ENVIRONMENT,
        SandboxPermission.CREATE_PROCESS,
        SandboxPermission.SYSTEM_CALL,
      ],
      [SandboxPlatform.MACOS]: [
        SandboxPermission.READ_FILE,
        SandboxPermission.WRITE_FILE,
        SandboxPermission.EXECUTE,
        SandboxPermission.NETWORK,
        SandboxPermission.ENVIRONMENT,
      ],
      [SandboxPlatform.UNKNOWN]: [
        SandboxPermission.READ_FILE,
        SandboxPermission.EXECUTE,
      ],
    };

    return permissions[platform] || [];
  }

  /**
   * 创建默认配置
   * @param platform 平台类型
   * @returns 默认配置
   */
  createDefaultConfig(platform: SandboxPlatform): SandboxConfig {
    const defaultPermissions = this.getSupportedPermissions(platform);

    return {
      platform,
      allowedPermissions: defaultPermissions,
      filesystemWhitelist: [],
      networkWhitelist: [],
      environmentWhitelist: [],
      maxExecutionTime: 30000,
      maxMemory: 256,
    };
  }
}

/**
 * 创建沙箱管理器实例
 * @returns 沙箱管理器实例
 */
export function createSandboxManager(): SandboxManagerImpl {
  return new SandboxManagerImpl();
}
