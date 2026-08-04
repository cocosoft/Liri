import { EventEmitter } from 'events';
import { join, resolve, dirname } from 'path';
import { resolveProjectRoot, resolveSecurityDir } from '@modules/core';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = getLogger('SecurityManager');

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
  /** 信任工作区列表 */
  trustedWorkspaces?: Array<{
    path: string;
    trustLevel: string;
    enabled: boolean;
  }>;
  /** 当前活跃工作空间路径 */
  activeWorkspacePath?: string;
  /** 用户自定义规则状态 */
  customRules?: {
    /** 命令黑白名单 */
    commandRules?: {
      blacklist: string[];
      whitelist: string[];
      mode: 'whitelist' | 'blacklist';
    };
    /** 目录黑白名单 */
    directoryRules?: {
      blacklist: string[];
      whitelist: string[];
    };
  };
}

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
 * 安全事件
 */
export interface SecurityEvent {
  action: string;
  result: 'allow' | 'deny';
  reason: string;
  details?: unknown;
  timestamp: number;
}

/**
 * 安全日志条目
 */
export interface SecurityLogEntry {
  timestamp: number;
  action: string;
  result: 'allow' | 'deny';
  reason: string;
  details?: unknown;
}

/**
 * 安全分析状态
 */
export interface SecurityAnalysisStatus {
  trustState: TrustState;
  sandboxConfig: SandboxConfig;
  recentSecurityEvents: SecurityLogEntry[];
  blockedAttempts: number;
  warnings: string[];
}

/**
 * 安全管理器类
 */
export class SecurityManager extends EventEmitter {
  private static instance: SecurityManager;
  private trustState: TrustState;
  private sandboxConfig: SandboxConfig;
  private options: SecurityOptions;
  private workspaceRoot: string;
  private configPath: string;
  private securityLog: SecurityLogEntry[] = [];
  private blockedCommands: Set<string> = new Set([
    'rm',
    'del',
    'erase',
    'format',
    'mkfs',
    'dd',
    'shutdown',
    'reboot',
    'halt',
    'poweroff',
    'curl',
    'wget',
    'fetch',
    'scp',
    'sftp',
  ]);

  private constructor() {
    super();
    this.configPath = this.getConfigPath();
    this.workspaceRoot = this.getWorkspaceRoot();
    this.trustState = {
      isTrusted: false,
      isInteractive: true,
    };
    this.sandboxConfig = this.getDefaultSandboxConfig();
    this.options = {
      allowedPaths: [],
      allowedCommands: [],
      maxExecutionTime: 30000,
      maxMemoryUsage: 100 * 1024 * 1024,
      disableNetwork: false,
      disableFileSystem: false,
      enableSandbox: true,
    };
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
    return join(resolveSecurityDir(), 'security.json');
  }

  private getWorkspaceRoot(): string {
    return resolveProjectRoot();
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
      blockedCommands: ['rm -rf /', 'del /f /q', 'format', 'dd'],
      allowedPaths: [],
      blockedPaths: ['C:\\Windows\\System32', '/etc/passwd', '/etc/shadow'],
      timeoutMs: 30000,
    };
  }

  /**
   * 加载安全配置
   */
  private loadSecurityConfig(): void {
    if (!existsSync(this.configPath)) {
      return;
    }
    try {
      const content = readFileSync(this.configPath, 'utf-8');
      const data = JSON.parse(content) as {
        trustState?: Partial<TrustState>;
        sandboxConfig?: Partial<SandboxConfig>;
        securityLog?: SecurityLogEntry[];
      };
      if (data.trustState) {
        this.trustState = { ...this.trustState, ...data.trustState };
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
      logger.error(
        'Failed to load security config',
        error instanceof Error ? error : undefined
      );
      void handleError(error, {
        module: 'hooks:security',
        action: 'loadSecurityConfig',
      });
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
      logger.error(
        'Failed to save security config',
        error instanceof Error ? error : undefined
      );
      void handleError(error, {
        module: 'hooks:security',
        action: 'saveSecurityConfig',
      });
    }
  }

  /**
   * 记录安全操作
   */
  private logSecurityAction(
    action: string,
    result: 'allow' | 'deny',
    reason: string,
    details?: unknown
  ): void {
    this.securityLog.push({
      timestamp: Date.now(),
      action,
      result,
      reason,
      details,
    });
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
    } satisfies SecurityEvent);
  }

  /**
   * 设置安全选项
   */
  setOptions(options: Partial<SecurityOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * 获取安全选项
   */
  getOptions(): SecurityOptions {
    return { ...this.options };
  }

  /**
   * 检查钩子是否应该由于工作区信任而被跳过
   */
  shouldSkipHookDueToTrust(): boolean {
    if (!this.trustState.isInteractive) {
      return false;
    }
    return !this.trustState.isTrusted;
  }

  /**
   * 验证钩子配置安全性
   */
  validateHookConfig(
    config: Record<string, unknown>
  ): SecurityValidationResult {
    const warnings: string[] = [];

    if (!config.type) {
      return { valid: false, error: 'Hook type is required' };
    }

    if (config.type === 'command' && config.command) {
      const command = String(config.command);

      for (const blocked of this.sandboxConfig.blockedCommands || []) {
        if (command.includes(blocked)) {
          this.logSecurityAction(
            'validate_hook',
            'deny',
            'Blocked command detected',
            {
              command,
              blocked,
            }
          );
          return {
            valid: false,
            error: `Command contains blocked pattern: ${blocked}`,
          };
        }
      }

      const commandName = command.split(/\s+/)[0];
      if (this.blockedCommands.has(commandName.toLowerCase())) {
        this.logSecurityAction(
          'validate_hook',
          'deny',
          'Blocked command name',
          {
            command,
            commandName,
          }
        );
        return {
          valid: false,
          error: `Command is not allowed: ${commandName}`,
        };
      }

      if (
        this.options.allowedCommands &&
        this.options.allowedCommands.length > 0
      ) {
        if (!this.options.allowedCommands.includes(commandName)) {
          return {
            valid: false,
            error: `Command is not in allowed list: ${commandName}`,
          };
        }
      }

      if (
        config.timeout !== undefined &&
        Number(config.timeout) > (this.options.maxExecutionTime ?? Infinity)
      ) {
        return {
          valid: false,
          error: 'Command timeout exceeds maximum allowed time',
        };
      }

      if (command.includes('..')) {
        warnings.push('Command contains path traversal pattern (..)');
      }

      const dangerousPatterns = [
        /\|.*grep.*-v/,
        />.*\//,
        /&&.*rm/,
        /\|\|.*del/,
      ];
      for (const pattern of dangerousPatterns) {
        if (pattern.test(command)) {
          warnings.push(
            `Command matches potentially dangerous pattern: ${pattern}`
          );
        }
      }
    }

    if (config.type === 'http') {
      if (this.options.disableNetwork) {
        return { valid: false, error: 'Network requests are disabled' };
      }
      if (!config.url) {
        return { valid: false, error: 'URL is required for http-type hook' };
      }
      if (!this.validateUrl(String(config.url))) {
        return { valid: false, error: 'URL is not allowed' };
      }

      const url = String(config.url);
      if (
        url.startsWith('http://localhost') ||
        url.startsWith('http://127.0.0.1')
      ) {
        warnings.push('HTTP hook targets localhost - ensure this is expected');
      }
      if (url.startsWith('http://') && !url.includes('localhost')) {
        warnings.push(
          'HTTP hook does not use HTTPS - consider using HTTPS for security'
        );
      }
    }

    if (config.type === 'file' || config.type === 'directory') {
      if (this.options.disableFileSystem) {
        return { valid: false, error: 'File system operations are disabled' };
      }
      if (config.path && !this.validatePath(String(config.path)).valid) {
        return { valid: false, error: 'Path is not allowed' };
      }
    }

    if (config.timeout !== undefined && Number(config.timeout) > 300000) {
      warnings.push(
        'Hook timeout exceeds 5 minutes - consider reducing for safety'
      );
    }

    if (warnings.length > 0) {
      this.logSecurityAction(
        'validate_hook',
        'allow',
        'Hook validated with warnings',
        { warnings, config }
      );
    }

    return {
      valid: true,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * 验证路径是否安全
   */
  validatePath(path: string): SecurityValidationResult {
    const { allowedPaths: configAllowedPaths, blockedPaths } =
      this.sandboxConfig;

    if (configAllowedPaths && configAllowedPaths.length > 0) {
      const isAllowed = configAllowedPaths.some((allowedPath) =>
        path.startsWith(allowedPath)
      );
      if (!isAllowed) {
        this.logSecurityAction(
          'validate_path',
          'deny',
          'Path not in allowed list',
          { path, allowedPaths: configAllowedPaths }
        );
        return { valid: false, error: 'Path is not in the allowed paths list' };
      }
    }

    for (const blockedPath of blockedPaths || []) {
      if (path.includes(blockedPath)) {
        this.logSecurityAction(
          'validate_path',
          'deny',
          'Path in blocked list',
          { path, blockedPath }
        );
        return {
          valid: false,
          error: `Path contains blocked path: ${blockedPath}`,
        };
      }
    }

    if (path.includes('..')) {
      this.logSecurityAction(
        'validate_path',
        'deny',
        'Path traversal detected',
        { path }
      );
      return { valid: false, error: 'Path contains traversal pattern (..)' };
    }

    if (this.options.disableFileSystem) {
      return { valid: false, error: 'File system operations are disabled' };
    }

    try {
      const resolvedPath = resolve(path);
      if (resolvedPath.startsWith(this.workspaceRoot)) {
        return { valid: true };
      }
      for (const allowedPath of this.options.allowedPaths || []) {
        if (resolvedPath.startsWith(resolve(allowedPath))) {
          return { valid: true };
        }
      }
      return {
        valid: false,
        error: 'Path is outside workspace and not in allowed paths',
      };
    } catch {
      void handleError(new Error('路径解析失败'), {
        module: 'hooks:security',
        action: 'validatePath',
      });
      return { valid: false, error: 'Failed to resolve path' };
    }
  }

  /**
   * 验证命令是否安全
   */
  validateCommand(command: string): SecurityValidationResult {
    for (const blocked of this.sandboxConfig.blockedCommands || []) {
      if (command.includes(blocked)) {
        this.logSecurityAction(
          'validate_command',
          'deny',
          'Blocked command detected',
          { command, blocked }
        );
        return {
          valid: false,
          error: `Command contains blocked pattern: ${blocked}`,
        };
      }
    }

    const commandName = command.split(/\s+/)[0];
    if (this.blockedCommands.has(commandName.toLowerCase())) {
      this.logSecurityAction(
        'validate_command',
        'deny',
        'Blocked command name',
        { command, commandName }
      );
      return { valid: false, error: `Command is not allowed: ${commandName}` };
    }

    if (
      this.options.allowedCommands &&
      this.options.allowedCommands.length > 0
    ) {
      if (!this.options.allowedCommands.includes(commandName)) {
        return {
          valid: false,
          error: `Command is not in allowed list: ${commandName}`,
        };
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
      return ['http:', 'https:'].includes(parsedUrl.protocol);
    } catch {
      void handleError(new Error('URL 验证失败'), {
        module: 'hooks:security',
        action: 'validateUrl',
      });
      return false;
    }
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
      { oldState, newState: this.trustState }
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
   * 添加信任工作区
   * @param path 工作区路径
   * @param trustLevel 信任级别（chat/work/development）
   */
  addTrustedWorkspace(path: string, trustLevel: string = 'development'): void {
    const workspaces = this.trustState.trustedWorkspaces || [];
    const exists = workspaces.find((ws) => ws.path === path);
    if (exists) {
      exists.trustLevel = trustLevel;
      exists.enabled = true;
    } else {
      workspaces.push({ path, trustLevel, enabled: true });
    }
    this.trustState.trustedWorkspaces = workspaces;
    this.saveSecurityConfig();
    this.emit('trustStateChanged', this.trustState);
  }

  /**
   * 移除信任工作区
   * @param path 工作区路径
   */
  removeTrustedWorkspace(path: string): void {
    const workspaces = this.trustState.trustedWorkspaces || [];
    this.trustState.trustedWorkspaces = workspaces.filter(
      (ws) => ws.path !== path
    );
    this.saveSecurityConfig();
    this.emit('trustStateChanged', this.trustState);
  }

  /**
   * 获取信任工作区列表
   */
  getTrustedWorkspaces(): Array<{
    path: string;
    trustLevel: string;
    enabled: boolean;
  }> {
    return [...(this.trustState.trustedWorkspaces || [])];
  }

  /**
   * 检查路径是否在信任工作区内
   * @param targetPath 待检查路径
   */
  isInTrustedWorkspace(targetPath: string): boolean {
    const workspaces = this.trustState.trustedWorkspaces || [];
    const normalizedPath = targetPath.replace(/\\/g, '/');
    return workspaces.some((ws) => {
      if (!ws.enabled) return false;
      return normalizedPath.startsWith(ws.path.replace(/\\/g, '/'));
    });
  }

  /**
   * 设置当前活跃工作空间路径
   * @param path 工作空间路径
   */
  setActiveWorkspacePath(path: string): void {
    this.trustState.activeWorkspacePath = path;
    this.saveSecurityConfig();
    this.emit('trustStateChanged', this.trustState);
  }

  /**
   * 获取当前活跃工作空间路径
   */
  getActiveWorkspacePath(): string | undefined {
    return this.trustState.activeWorkspacePath;
  }

  /**
   * 设置自定义规则
   * @param rules 自定义规则
   */
  setCustomRules(rules: NonNullable<TrustState['customRules']>): void {
    this.trustState.customRules = rules;
    this.saveSecurityConfig();
    this.emit('trustStateChanged', this.trustState);
  }

  /**
   * 获取自定义规则
   */
  getCustomRules(): TrustState['customRules'] {
    return this.trustState.customRules;
  }

  /**
   * 设置沙箱配置
   */
  setSandboxConfig(config: Partial<SandboxConfig>): void {
    this.sandboxConfig = { ...this.sandboxConfig, ...config };
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
  getSecurityLog(limit?: number): SecurityLogEntry[] {
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
  analyzeSecurityStatus(): SecurityAnalysisStatus {
    const recentSecurityEvents = this.securityLog.slice(-20);
    const blockedAttempts = this.securityLog.filter(
      (log) => log.result === 'deny'
    ).length;
    const warnings: string[] = [];

    if (!this.trustState.isTrusted && this.trustState.isInteractive) {
      warnings.push('工作区未被信任，钩子执行将被跳过');
    }
    if (!this.sandboxConfig.enabled) {
      warnings.push('沙箱未启用，存在安全风险');
    }
    if (blockedAttempts > 10) {
      warnings.push(
        `检测到 ${blockedAttempts} 次被阻止的安全尝试，建议检查配置`
      );
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
   * 检查工作区是否可信
   */
  isWorkspaceTrusted(): boolean {
    const trustedFile = join(this.workspaceRoot, '.pyapp-trusted');
    return existsSync(trustedFile);
  }

  /**
   * 设置工作区为可信
   */
  setWorkspaceTrusted(): void {
    const trustedFile = join(this.workspaceRoot, '.pyapp-trusted');
    try {
      writeFileSync(trustedFile, '# Liri Trusted Workspace\n');
      this.trustState.isTrusted = true;
      this.saveSecurityConfig();
    } catch (error) {
      logger.error(
        'Failed to set workspace as trusted',
        error instanceof Error ? error : undefined
      );
      void handleError(error, {
        module: 'hooks:security',
        action: 'setWorkspaceTrusted',
      });
    }
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
    this.options = {
      allowedPaths: [],
      allowedCommands: [],
      maxExecutionTime: 30000,
      maxMemoryUsage: 100 * 1024 * 1024,
      disableNetwork: false,
      disableFileSystem: false,
      enableSandbox: true,
    };
    this.securityLog = [];
    this.saveSecurityConfig();
    this.removeAllListeners();
  }
}

/**
 * 导出单例
 */
export const securityManager = SecurityManager.getInstance();
