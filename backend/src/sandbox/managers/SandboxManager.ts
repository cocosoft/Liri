/**
 * 沙箱管理器
 * 统一管理沙箱约束的各个组件
 */
import {
  SandboxSettings,
  SandboxConstraints,
  SandboxCheckResult,
  SandboxViolationEvent,
  SandboxFilesystemConfig,
  SandboxNetworkConfig,
  SandboxExecuteResult,
  createDefaultSandboxSettings,
  createDefaultSandboxConstraints,
} from '../types/SandboxTypes';
import { checkDangerousCommand } from '../utils/DangerousCommandChecker';
import {
  checkPathAccess,
  checkReadPathAccess,
  checkWritePathAccess,
  validatePathSafety,
} from '../utils/PathRestrictions';
import {
  TimeoutController,
  executeWithTimeout,
  DEFAULT_TIMEOUT_MS,
} from '../utils/TimeoutController';

/**
 * 沙箱管理器
 */
export class SandboxManager {
  private static instance: SandboxManager;

  private settings: SandboxSettings;
  private constraints: SandboxConstraints;
  private violations: SandboxViolationEvent[] = [];
  private enabled: boolean = false;

  private constructor() {
    this.settings = createDefaultSandboxSettings();
    this.constraints = createDefaultSandboxConstraints();
  }

  /**
   * 获取单例实例
   */
  public static getInstance(): SandboxManager {
    if (!SandboxManager.instance) {
      SandboxManager.instance = new SandboxManager();
    }
    return SandboxManager.instance;
  }

  /**
   * 更新沙箱设置
   */
  public updateSettings(settings: Partial<SandboxSettings>): void {
    this.settings = { ...this.settings, ...settings };
    this.enabled = this.settings.enabled ?? false;
  }

  /**
   * 获取当前设置
   */
  public getSettings(): SandboxSettings {
    return { ...this.settings };
  }

  /**
   * 更新沙箱约束
   */
  public updateConstraints(constraints: Partial<SandboxConstraints>): void {
    this.constraints = { ...this.constraints, ...constraints };
  }

  /**
   * 获取当前约束
   */
  public getConstraints(): SandboxConstraints {
    return { ...this.constraints };
  }

  /**
   * 检查沙箱是否启用
   */
  public isSandboxingEnabled(): boolean {
    return this.enabled;
  }

  /**
   * 检查是否允许非沙箱命令
   */
  public areUnsandboxedCommandsAllowed(): boolean {
    return this.settings.allowUnsandboxedCommands ?? true;
  }

  /**
   * 检查命令是否应该使用沙箱
   */
  public shouldUseSandbox(input: {
    command?: string;
    dangerouslyDisableSandbox?: boolean;
  }): boolean {
    if (!this.isSandboxingEnabled()) {
      return false;
    }

    if (
      input.dangerouslyDisableSandbox &&
      this.areUnsandboxedCommandsAllowed()
    ) {
      return false;
    }

    if (!input.command) {
      return false;
    }

    if (this.containsExcludedCommand(input.command)) {
      return false;
    }

    return true;
  }

  /**
   * 检查命令是否包含排除命令
   */
  private containsExcludedCommand(command: string): boolean {
    const excludedCommands = this.settings.excludedCommands ?? [];
    if (excludedCommands.length === 0) {
      return false;
    }

    const result = checkDangerousCommand(command, excludedCommands);
    return result.isDangerous;
  }

  /**
   * 检查命令安全性
   */
  public checkCommand(command: string): SandboxCheckResult {
    const excludedCommands = this.settings.excludedCommands ?? [];
    const result = checkDangerousCommand(command, excludedCommands);

    if (result.isDangerous) {
      return {
        allowed: false,
        reason: result.reason ?? '命令不安全',
        matchedPattern: result.matchedPattern,
      };
    }

    return {
      allowed: true,
      reason: '命令安全',
    };
  }

  /**
   * 检查路径访问权限
   */
  public checkPath(
    targetPath: string,
    type: 'read' | 'write' | 'access' = 'access'
  ): SandboxCheckResult {
    const filesystemConfig: SandboxFilesystemConfig = {
      allowRead: this.settings.filesystem?.allowRead,
      denyRead: this.settings.filesystem?.denyRead,
      allowWrite: this.settings.filesystem?.allowWrite,
      denyWrite: this.settings.filesystem?.denyWrite,
      allowManagedReadPathsOnly:
        this.settings.filesystem?.allowManagedReadPathsOnly,
    };

    let result: {
      allowed: boolean;
      reason?: string;
      matchedPattern?: string;
      pathType?: string;
    };

    switch (type) {
      case 'read':
        result = checkReadPathAccess(targetPath, filesystemConfig);
        break;
      case 'write':
        result = checkWritePathAccess(targetPath, filesystemConfig);
        break;
      default:
        result = checkPathAccess(
          targetPath,
          this.constraints.allowedPaths,
          this.constraints.deniedPaths
        );
        break;
    }

    return {
      allowed: result.allowed,
      reason: result.reason ?? '未知原因',
      matchedPattern: result.matchedPattern,
    };
  }

  /**
   * 检查域名访问权限
   */
  public checkDomain(domain: string): SandboxCheckResult {
    const allowedDomains = this.settings.network?.allowedDomains ?? [];
    const deniedDomains: string[] = [];

    for (const denied of deniedDomains) {
      if (domain.includes(denied) || denied === '*') {
        return {
          allowed: false,
          reason: `域名匹配拒绝模式: ${denied}`,
        };
      }
    }

    if (allowedDomains.length > 0) {
      for (const allowed of allowedDomains) {
        if (domain.includes(allowed) || allowed === '*') {
          return {
            allowed: true,
            reason: `域名匹配允许模式: ${allowed}`,
          };
        }
      }
      return {
        allowed: false,
        reason: '域名不在允许列表中',
      };
    }

    return {
      allowed: true,
      reason: '无限制',
    };
  }

  /**
   * 记录沙箱违规
   */
  public recordViolation(
    event: Omit<SandboxViolationEvent, 'timestamp'>
  ): void {
    this.violations.push({
      ...event,
      timestamp: new Date(),
    });
  }

  /**
   * 获取所有违规记录
   */
  public getViolations(): SandboxViolationEvent[] {
    return [...this.violations];
  }

  /**
   * 清除违规记录
   */
  public clearViolations(): void {
    this.violations = [];
  }

  /**
   * 获取违规统计
   */
  public getViolationStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const v of this.violations) {
      stats[v.type] = (stats[v.type] || 0) + 1;
    }
    return stats;
  }

  /**
   * 执行带沙箱约束的命令
   */
  public async executeWithConstraints<T>(
    fn: (abortSignal: AbortSignal) => Promise<T>,
    options?: {
      timeoutMs?: number;
      command?: string;
      baseDirectory?: string;
    }
  ): Promise<{
    success: boolean;
    data?: T;
    error?: string;
    timedOut: boolean;
    durationMs: number;
  }> {
    const timeoutMs =
      options?.timeoutMs ??
      this.constraints.maxExecutionTimeMs ??
      DEFAULT_TIMEOUT_MS;

    return executeWithTimeout(fn, timeoutMs, options?.command);
  }

  /**
   * 执行沙箱命令
   * @param _sandboxId 沙箱ID
   * @param command 命令字符串
   * @param _options 执行选项
   * @returns 执行结果
   */
  public async execute(
    _sandboxId: string,
    command: string,
    _options?: any
  ): Promise<SandboxExecuteResult> {
    const startTime = Date.now();
    const checkResult = this.checkCommand(command);

    if (!checkResult.allowed) {
      return {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: checkResult.reason || 'Command not allowed',
        executionTime: Date.now() - startTime,
        error: checkResult.reason,
      };
    }

    try {
      const result = await this.executeWithConstraints(
        async () => {
          const { exec } = await import('child_process');
          const { promisify } = await import('util');
          const execAsync = promisify(exec);
          const { stdout, stderr } = await execAsync(command);
          return { stdout, stderr };
        },
        { command }
      );

      return {
        success: result.success,
        exitCode: result.success ? 0 : 1,
        stdout: result.data?.stdout || '',
        stderr: result.data?.stderr || result.error || '',
        executionTime: result.durationMs,
        error: result.error,
      };
    } catch (error) {
      return {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        executionTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 验证路径安全性
   */
  public validatePath(
    targetPath: string,
    baseDirectory: string
  ): { safe: boolean; reason?: string } {
    return validatePathSafety(targetPath, baseDirectory);
  }

  /**
   * 获取沙箱状态摘要
   */
  public getStatus(): {
    enabled: boolean;
    settings: SandboxSettings;
    constraints: SandboxConstraints;
    violationCount: number;
  } {
    return {
      enabled: this.enabled,
      settings: this.getSettings(),
      constraints: this.getConstraints(),
      violationCount: this.violations.length,
    };
  }

  /**
   * 重置管理器状态
   */
  public reset(): void {
    this.settings = createDefaultSandboxSettings();
    this.constraints = createDefaultSandboxConstraints();
    this.violations = [];
    this.enabled = false;
  }
}
