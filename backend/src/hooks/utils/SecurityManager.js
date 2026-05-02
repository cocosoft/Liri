/**
 * 安全管理器
 * 提供钩子执行的安全控制功能
 * 参考CC源码: cc_code/backend/utils/hooks.ts 中的工作区信任检查
 */

import { EventEmitter } from 'events';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

/**
 * 安全验证结果
 */
export interface SecurityValidationResult {
  valid: boolean;
  error?: string;
  warnings?: string[];
}

/**
 * 沙箱配置
 */
export interface SandboxConfig {
  enabled: boolean;
  maxMemoryMB?: number;
  maxCpuPercent?: number;
  allowedCommands?: string[];
  blockedCommands?: string[];
  allowedPaths?: string[];
  blockedPaths?: string[];
  timeoutMs?: number;
}

/**
 * 信任状态
 */
export interface TrustState {
  isTrusted: boolean;
  isInteractive: boolean;
  trustDialogAccepted?: boolean;
  workspaceRoot?: string;
}

/**
 * 安全管理器类
 */
class SecurityManager extends EventEmitter {
  private static instance: SecurityManager;
  private trustState: TrustState;
  private sandboxConfig: SandboxConfig;
  private configPath: string;
  private securityLog: Array<{
    timestamp: number;
    action: string;
    result: 'allow' | 'deny';
    reason: string;
    details?: any;
  }> = [];

  private constructor() {
    super();
    this.configPath = this.getConfigPath();
    this.trustState = {
      isTrusted: false,
      isInteractive: true,
    };
    this.sandboxConfig = this.getDefaultSandboxConfig();
    this.ensureConfigDirectory();
    this.loadSecurityConfig();
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
   * 获取配置路径
   */
  private getConfigPath(): string {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    return join(__dirname, '..', '..', '..', 'config', 'security.json');
  }

  /**
   * 确保配置目录存在
   */
  private ensureConfigDirectory(): void {
    const configDir = dirname(this.configPath);
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }
  }

  /**
   * 获取默认沙箱配置
   */
  private getDefaultSandboxConfig(): SandboxConfig {
    return {
      enabled: false,
      maxMemoryMB: 512,
      maxCpuPercent: 50,
      allowedCommands: [],
      blockedCommands: [
        'rm -rf /',
        'del /f /q',
        'format',
        'dd',
      ],
      allowedPaths: [],
      blockedPaths: [
        'C:\\Windows\\System32',
        '/etc/passwd',
        '/etc/shadow',
      ],
      timeoutMs: 30000,
    };
  }

  /**
   * 加载安全配置
   */
  private loadSecurityConfig(): void {
    if (existsSync(this.configPath)) {
      try {
        const content = readFileSync(this.configPath, 'utf-8');
        const data = JSON.parse(content);

        if (data.trustState) {
          this.trustState = {
            ...this.trustState,
            ...data.trustState,
          };
        }

        if (data.sandboxConfig) {
          this.sandboxConfig = {
            ...this.getDefaultSandboxConfig(),
            ...data.sandboxConfig,
          };
        }

        if (data.securityLog) {
          this.securityLog = data.securityLog;
        }
      } catch (error) {
        console.error('Failed to load security config:', error);
      }
    }
  }

  /**
   * 保存安全配置
   */
  private saveSecurityConfig(): void {
    try {
      const data = {
        trustState: this.trustState,
        sandboxConfig: this.sandboxConfig,
        securityLog: this.securityLog.slice(-1000),
      };
      writeFileSync(this.configPath, JSON.stringify(data, null, 2) + '\n');
    } catch (error) {
      console.error('Failed to save security config:', error);
    }
  }

  /**
   * 记录安全操作
   */
  private logSecurityAction(
    action: string,
    result: 'allow' | 'deny',
    reason: string,
    details?: any
  ): void {
    this.securityLog.push({
      timestamp: Date.now(),
      action,
      result,
      reason,
      details,
    });

    // 限制日志大小
    if (this.securityLog.length > 1000) {
      this.securityLog = this.securityLog.slice(-1000);
    }

    this.saveSecurityConfig();

    this.emit('securityEvent', {
      action,
      result,
      reason,
      details,
      timestamp: Date.now(),
    });
  }

  /**
   * 检查钩子是否应该由于工作区信任而被跳过
   */
  shouldSkipHookDueToTrust(): boolean {
    // 在非交互模式下（SDK），信任是隐式的 - 始终执行
    if (!this.trustState.isInteractive) {
      return false;
    }

    // 在交互模式下，所有钩子都需要信任
    return !this.trustState.isTrusted;
  }

  /**
   * 验证钩子配置安全性
   */
  validateHookConfig(config: any): SecurityValidationResult {
    const warnings: string[] = [];

    // 检查命令类型钩子
    if (config.type === 'command' && config.command) {
      // 检查是否包含危险命令
      for (const blocked of this.sandboxConfig.blockedCommands || []) {
        if (config.command.includes(blocked)) {
          this.logSecurityAction('validate_hook', 'deny', 'Blocked command detected', {
            command: config.command,
            blocked,
          });
          return {
            valid: false,
            error: `Command contains blocked pattern: ${blocked}`,
          };
        }
      }

      // 检查路径安全
      if (config.command.includes('..')) {
        warnings.push('Command contains path traversal pattern (..)');
      }

      // 检查潜在的危险模式
      const dangerousPatterns = [
        /\|.*grep.*-v/,
        />.*\//,
        /&&.*rm/,
        /\|\|.*del/,
      ];

      for (const pattern of dangerousPatterns) {
        if (pattern.test(config.command)) {
          warnings.push(`Command matches potentially dangerous pattern: ${pattern}`);
        }
      }
    }

    // 检查HTTP钩子
    if (config.type === 'http' && config.url) {
      // 检查是否是本地地址
      if (
        config.url.startsWith('http://localhost') ||
        config.url.startsWith('http://127.0.0.1')
      ) {
        warnings.push('HTTP hook targets localhost - ensure this is expected');
      }

      // 检查是否使用HTTPS
      if (config.url.startsWith('http://') && !config.url.includes('localhost')) {
        warnings.push('HTTP hook does not use HTTPS - consider using HTTPS for security');
      }
    }

    // 检查超时配置
    if (config.timeout && config.timeout > 300000) {
      warnings.push('Hook timeout exceeds 5 minutes - consider reducing for safety');
    }

    if (warnings.length > 0) {
      this.logSecurityAction('validate_hook', 'allow', 'Hook validated with warnings', {
        warnings,
        config,
      });
    }

    return {
      valid: true,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * 验证路径安全性
   */
  validatePath(path: string): SecurityValidationResult {
    // 检查是否包含在允许的路径中
    if (this.sandboxConfig.allowedPaths && this.sandboxConfig.allowedPaths.length > 0) {
      const isAllowed = this.sandboxConfig.allowedPaths.some(allowedPath =>
        path.startsWith(allowedPath)
      );

      if (!isAllowed) {
        this.logSecurityAction('validate_path', 'deny', 'Path not in allowed list', {
          path,
          allowedPaths: this.sandboxConfig.allowedPaths,
        });
        return {
          valid: false,
          error: 'Path is not in the allowed paths list',
        };
      }
    }

    // 检查是否包含在阻止的路径中
    for (const blockedPath of this.sandboxConfig.blockedPaths || []) {
      if (path.includes(blockedPath)) {
        this.logSecurityAction('validate_path', 'deny', 'Path in blocked list', {
          path,
          blockedPath,
        });
        return {
          valid: false,
          error: `Path contains blocked path: ${blockedPath}`,
        };
      }
    }

    // 检查路径遍历
    if (path.includes('..')) {
      this.logSecurityAction('validate_path', 'deny', 'Path traversal detected', {
        path,
      });
      return {
        valid: false,
        error: 'Path contains traversal pattern (..)',
      };
    }

    return { valid: true };
  }

  /**
   * 验证命令安全性
   */
  validateCommand(command: string): SecurityValidationResult {
    // 检查是否包含危险命令
    for (const blocked of this.sandboxConfig.blockedCommands || []) {
      if (command.includes(blocked)) {
        this.logSecurityAction('validate_command', 'deny', 'Blocked command detected', {
          command,
          blocked,
        });
        return {
          valid: false,
          error: `Command contains blocked pattern: ${blocked}`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * 设置信任状态
   */
  setTrustState(trustState: Partial<TrustState>): void {
    const oldState = { ...this.trustState };
    this.trustState = { ...this.trustState, ...trustState };

    this.logSecurityAction(
      'set_trust',
      this.trustState.isTrusted ? 'allow' : 'deny',
      'Trust state updated',
      {
        oldState,
        newState: this.trustState,
      }
    );

    this.saveSecurityConfig();
    this.emit('trustStateChanged', this.trustState);
  }

  /**
   * 获取信任状态
   */
  getTrustState(): TrustState {
    return { ...this.trustState };
  }

  /**
   * 设置沙箱配置
   */
  setSandboxConfig(config: Partial<SandboxConfig>): void {
    this.sandboxConfig = {
      ...this.sandboxConfig,
      ...config,
    };
    this.saveSecurityConfig();
    this.emit('sandboxConfigChanged', this.sandboxConfig);
  }

  /**
   * 获取沙箱配置
   */
  getSandboxConfig(): SandboxConfig {
    return { ...this.sandboxConfig };
  }

  /**
   * 获取安全日志
   */
  getSecurityLog(limit?: number): Array<{
    timestamp: number;
    action: string;
    result: 'allow' | 'deny';
    reason: string;
    details?: any;
  }> {
    return limit ? this.securityLog.slice(-limit) : [...this.securityLog];
  }

  /**
   * 清除安全日志
   */
  clearSecurityLog(): void {
    this.securityLog = [];
    this.saveSecurityConfig();
  }

  /**
   * 分析安全状态
   */
  analyzeSecurityStatus(): {
    trustState: TrustState;
    sandboxConfig: SandboxConfig;
    recentSecurityEvents: Array<{
      timestamp: number;
      action: string;
      result: 'allow' | 'deny';
      reason: string;
    }>;
    blockedAttempts: number;
    warnings: string[];
  } {
    const recentSecurityEvents = this.securityLog.slice(-20);
    const blockedAttempts = this.securityLog.filter(
      log => log.result === 'deny'
    ).length;

    const warnings: string[] = [];

    if (!this.trustState.isTrusted && this.trustState.isInteractive) {
      warnings.push('工作区未被信任，钩子执行将被跳过');
    }

    if (!this.sandboxConfig.enabled) {
      warnings.push('沙箱未启用，存在安全风险');
    }

    if (blockedAttempts > 10) {
      warnings.push(`检测到 ${blockedAttempts} 次被阻止的安全尝试，建议检查配置`);
    }

    return {
      trustState: this.trustState,
      sandboxConfig: this.sandboxConfig,
      recentSecurityEvents,
      blockedAttempts,
      warnings,
    };
  }

  /**
   * 重置管理器
   */
  reset(): void {
    this.trustState = {
      isTrusted: false,
      isInteractive: true,
    };
    this.sandboxConfig = this.getDefaultSandboxConfig();
    this.securityLog = [];
    this.saveSecurityConfig();
    this.removeAllListeners();
  }
}

/**
 * 导出单例
 */
SecurityManager.instance = new SecurityManager();

export { SecurityManager };
export const securityManager = SecurityManager.getInstance();
