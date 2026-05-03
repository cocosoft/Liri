// @ts-nocheck
/**
 * 安全管理器
 * 提供钩子系统的安全功能
 */

import { EventEmitter } from 'events';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, lstatSync } from 'fs';

/**
 * 安全选项
 */
export interface SecurityOptions {
  allowedPaths?: string[];
  allowedCommands?: string[];
  maxExecutionTime?: number;
  maxMemoryUsage?: number;
  disableNetwork?: boolean;
  disableFileSystem?: boolean;
  enableSandbox?: boolean;
}

/**
 * 安全管理器类
 */
export class SecurityManager extends EventEmitter {
  private static instance: SecurityManager;
  private options: SecurityOptions;
  private workspaceRoot: string;
  private blockedCommands: Set<string> = new Set([
    'rm', 'del', 'erase', 'format', 'mkfs', 'dd',
    'shutdown', 'reboot', 'halt', 'poweroff',
    'curl', 'wget', 'fetch', 'scp', 'sftp',
  ]);

  private constructor() {
    super();
    this.options = {
      allowedPaths: [],
      allowedCommands: [],
      maxExecutionTime: 30000, // 默认30秒
      maxMemoryUsage: 100 * 1024 * 1024, // 默认100MB
      disableNetwork: false,
      disableFileSystem: false,
      enableSandbox: true,
    };
    this.workspaceRoot = this.getWorkspaceRoot();
  }

  /**
   * 获取单例实例
   */
  static getInstance(): SecurityManager {
    if (!SecurityManager.instance) {
      SecurityManager.instance = new SecurityManager();
    }
    return SecurityManager.instance;
  }

  /**
   * 获取工作区根目录
   */
  private getWorkspaceRoot(): string {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    return join(__dirname, '..', '..', '..');
  }

  /**
   * 设置安全选项
   */
  setOptions(options: SecurityOptions): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * 获取安全选项
   */
  getOptions(): SecurityOptions {
    return { ...this.options };
  }

  /**
   * 验证路径是否安全
   */
  validatePath(path: string): boolean {
    if (this.options.disableFileSystem) {
      return false;
    }

    try {
      const resolvedPath = resolve(path);
      
      // 检查是否在工作区目录内
      if (resolvedPath.startsWith(this.workspaceRoot)) {
        return true;
      }

      // 检查是否在允许的路径列表中
      if (this.options.allowedPaths) {
        for (const allowedPath of this.options.allowedPaths) {
          if (resolvedPath.startsWith(resolve(allowedPath))) {
            return true;
          }
        }
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * 验证命令是否安全
   */
  validateCommand(command: string): boolean {
    // 提取命令名
    const commandName = command.split(/\s+/)[0];
    
    // 检查是否在阻止列表中
    if (this.blockedCommands.has(commandName.toLowerCase())) {
      return false;
    }

    // 检查是否在允许列表中
    if (this.options.allowedCommands && this.options.allowedCommands.length > 0) {
      return this.options.allowedCommands.includes(commandName);
    }

    // 默认允许
    return true;
  }

  /**
   * 验证Hook配置是否安全
   */
  validateHookConfig(config: any): { valid: boolean; error?: string } {
    // 检查类型
    if (!config.type) {
      return { valid: false, error: 'Hook type is required' };
    }

    // 检查命令类型Hook
    if (config.type === 'command') {
      if (!config.command) {
        return { valid: false, error: 'Command is required for command-type hook' };
      }

      if (!this.validateCommand(config.command)) {
        return { valid: false, error: 'Command is not allowed' };
      }

      // 检查执行时间
      if (config.timeout && config.timeout > this.options.maxExecutionTime) {
        return { valid: false, error: 'Command timeout exceeds maximum allowed time' };
      }
    }

    // 检查HTTP类型Hook
    if (config.type === 'http') {
      if (this.options.disableNetwork) {
        return { valid: false, error: 'Network requests are disabled' };
      }

      if (!config.url) {
        return { valid: false, error: 'URL is required for http-type hook' };
      }

      // 检查URL安全性
      if (!this.validateUrl(config.url)) {
        return { valid: false, error: 'URL is not allowed' };
      }
    }

    // 检查文件系统操作
    if (config.type === 'file' || config.type === 'directory') {
      if (this.options.disableFileSystem) {
        return { valid: false, error: 'File system operations are disabled' };
      }

      if (config.path && !this.validatePath(config.path)) {
        return { valid: false, error: 'Path is not allowed' };
      }
    }

    return { valid: true };
  }

  /**
   * 验证URL是否安全
   */
  private validateUrl(url: string): boolean {
    try {
      const parsedUrl = new URL(url);
      
      // 只允许http和https协议
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return false;
      }

      // 可以添加更多URL验证逻辑
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 获取沙箱环境配置
   */
  getSandboxConfig(): any {
    if (!this.options.enableSandbox) {
      return {};
    }

    return {
      cwd: this.workspaceRoot,
      env: {
        HOME: this.workspaceRoot,
        TEMP: join(this.workspaceRoot, 'temp'),
        TMP: join(this.workspaceRoot, 'temp'),
      },
      timeout: this.options.maxExecutionTime,
      maxMemory: this.options.maxMemoryUsage,
      disableNetwork: this.options.disableNetwork,
      disableFileSystem: this.options.disableFileSystem,
      allowedPaths: this.options.allowedPaths || [this.workspaceRoot],
    };
  }

  /**
   * 检查工作区是否可信
   */
  isWorkspaceTrusted(): boolean {
    // 检查是否存在可信标记文件
    const trustedFile = join(this.workspaceRoot, '.pyapp-trusted');
    return existsSync(trustedFile);
  }

  /**
   * 设置工作区为可信
   */
  setWorkspaceTrusted(): void {
    const trustedFile = join(this.workspaceRoot, '.pyapp-trusted');
    try {
      // 创建可信标记文件
      require('fs').writeFileSync(trustedFile, '# PY_APP Trusted Workspace\n');
    } catch (error) {
      console.error('Failed to set workspace as trusted:', error);
    }
  }

  /**
   * 重置管理器
   */
  reset(): void {
    this.options = {
      allowedPaths: [],
      allowedCommands: [],
      maxExecutionTime: 30000,
      maxMemoryUsage: 100 * 1024 * 1024,
      disableNetwork: false,
      disableFileSystem: false,
      enableSandbox: true,
    };
    this.removeAllListeners();
  }
}

/**
 * 导出单例
 */
export const securityManager = SecurityManager.getInstance();

// 辅助函数
function dirname(path: string): string {
  return path.substring(0, path.lastIndexOf('/'));
}
