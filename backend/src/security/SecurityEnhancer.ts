/**
 * 安全增强器
 * 整合所有安全相关的功能，提供统一的安全管理接口
 */

import {
  SecurityScanner,
  createSecurityScanner,
} from './scanners/SecurityScanner.js';
import {
  SecurityAuditManager,
  createSecurityAuditManager,
  AuditEventType,
  AuditEventSeverity,
} from './managers/SecurityAuditManager.js';
import {
  FineGrainedPermissionManager,
  createFineGrainedPermissionManager,
} from '../permission/FineGrainedPermissionManager.js';
import {
  PermissionManager,
  createPermissionManager,
} from '../permission/PermissionManager.js';
import {
  InputValidator,
  createInputValidator,
} from './validators/InputValidator.js';
import {
  ResourceType,
  OperationType,
} from '../permission/models/Permission.js';
import type { AuditEvent } from './managers/SecurityAuditManager.js';
import type { Vulnerability } from './scanners/SecurityScanner.js';
import type { PermissionContext } from '../permission/models/Permission.js';
import type { PermissionDecision } from '../permission/types/PermissionDecision.js';

/**
 * 安全增强器选项
 */
export interface SecurityEnhancerOptions {
  /** 审计日志目录 */
  auditDir: string;
  /** 扫描路径 */
  scanPaths?: string[];
  /** 忽略路径 */
  ignorePaths?: string[];
  /** 是否启用安全扫描 */
  enableSecurityScan?: boolean;
  /** 是否启用安全审计 */
  enableSecurityAudit?: boolean;
  /** 是否启用细粒度权限控制 */
  enableFineGrainedPermissions?: boolean;
}

/**
 * 安全增强器
 */
export class SecurityEnhancer {
  /** 安全扫描器 */
  private securityScanner: SecurityScanner;
  /** 安全审计管理器 */
  private securityAuditManager: SecurityAuditManager;
  /** 权限管理器 */
  private permissionManager: PermissionManager;
  /** 细粒度权限管理器 */
  private fineGrainedPermissionManager: FineGrainedPermissionManager;
  /** 输入验证器 */
  private inputValidator: InputValidator;
  /** 选项 */
  private options: SecurityEnhancerOptions;

  /**
   * 构造函数
   */
  constructor(options: SecurityEnhancerOptions) {
    this.options = {
      scanPaths: ['./src'],
      ignorePaths: ['./node_modules', './dist', './build'],
      enableSecurityScan: true,
      enableSecurityAudit: true,
      enableFineGrainedPermissions: true,
      ...options,
    };

    this.securityScanner = createSecurityScanner(
      this.options.scanPaths,
      this.options.ignorePaths
    );
    this.securityAuditManager = createSecurityAuditManager({
      auditDir: this.options.auditDir,
    });
    this.permissionManager = createPermissionManager();
    this.fineGrainedPermissionManager = createFineGrainedPermissionManager();
    this.inputValidator = createInputValidator();
  }

  /**
   * 初始化
   */
  async initialize(): Promise<void> {
    if (this.options.enableSecurityAudit) {
      await this.securityAuditManager.initialize();
    }

    // 记录安全增强器初始化
    await this.logAuditEvent({
      type: AuditEventType.CONFIGURATION_CHANGE,
      severity: AuditEventSeverity.INFO,
      description: 'Security enhancer initialized',
      details: {
        enableSecurityScan: this.options.enableSecurityScan,
        enableSecurityAudit: this.options.enableSecurityAudit,
        enableFineGrainedPermissions: this.options.enableFineGrainedPermissions,
      },
    });
  }

  /**
   * 执行安全扫描
   */
  async runSecurityScan(): Promise<Vulnerability[]> {
    if (!this.options.enableSecurityScan) {
      return [];
    }

    const vulnerabilities = await this.securityScanner.scan();

    // 记录扫描结果
    for (const vulnerability of vulnerabilities) {
      await this.securityAuditManager.logSecurityVulnerability(
        vulnerability.type,
        vulnerability.description,
        vulnerability.severity,
        vulnerability.location
      );
    }

    return vulnerabilities;
  }

  /**
   * 检查工具权限
   */
  async checkToolPermission(
    toolName: string,
    input: Record<string, unknown>,
    sessionId?: string,
    userId?: string
  ): Promise<{ action: string; reason: string; ruleId?: string }> {
    // 先进行输入验证
    const validationResult = this.inputValidator.validate(input, []);
    if (!validationResult.valid) {
      await this.logAuditEvent({
        type: AuditEventType.PERMISSION_DENY,
        severity: AuditEventSeverity.ERROR,
        description: `Input validation failed for tool ${toolName}`,
        details: {
          toolName,
          input,
          error: validationResult.error,
        },
        sessionId,
        userId,
      });

      return {
        action: 'deny',
        reason: 'Input validation failed',
        ruleId: 'input-validation',
      };
    }

    // 检查细粒度权限
    if (this.options.enableFineGrainedPermissions) {
      const permissionContext: PermissionContext = {
        userId,
        resource: {
          id: toolName,
          type: ResourceType.TOOL,
          name: toolName,
        },
        operation: OperationType.EXECUTE,
        input,
      };

      const decision =
        await this.fineGrainedPermissionManager.checkPermission(
          permissionContext
        );

      // 记录权限检查结果
      await this.securityAuditManager.logPermissionCheck(
        toolName,
        input,
        decision.action === 'allow',
        decision.reason,
        sessionId,
        userId
      );

      return decision;
    }

    // 使用传统权限管理器
    const decision = await this.permissionManager.checkPermission(
      toolName,
      input
    );

    // 记录权限检查结果
    await this.securityAuditManager.logPermissionCheck(
      toolName,
      input,
      decision.type === 'allow',
      decision.reason,
      sessionId,
      userId
    );

    return {
      action: decision.type,
      reason: decision.reason,
      ruleId: decision.rule?.id,
    };
  }

  /**
   * 验证输入
   */
  validateInput(input: Record<string, unknown>): {
    valid: boolean;
    error?: string;
  } {
    return this.inputValidator.validate(input, []);
  }

  /**
   * 记录审计事件
   */
  async logAuditEvent(
    event: Omit<AuditEvent, 'id' | 'timestamp'>
  ): Promise<void> {
    if (this.options.enableSecurityAudit) {
      await this.securityAuditManager.logEvent(event);
    }
  }

  /**
   * 记录工具执行
   */
  async logToolExecution(
    toolName: string,
    input: Record<string, unknown>,
    success: boolean,
    result?: any,
    error?: any,
    sessionId?: string,
    userId?: string
  ): Promise<void> {
    if (this.options.enableSecurityAudit) {
      await this.securityAuditManager.logToolExecution(
        toolName,
        input,
        success,
        result,
        error,
        sessionId,
        userId
      );
    }
  }

  /**
   * 记录命令执行
   */
  async logCommandExecution(
    command: string,
    args: string[],
    success: boolean,
    output?: string,
    error?: string,
    sessionId?: string,
    userId?: string
  ): Promise<void> {
    if (this.options.enableSecurityAudit) {
      await this.securityAuditManager.logCommandExecution(
        command,
        args,
        success,
        output,
        error,
        sessionId,
        userId
      );
    }
  }

  /**
   * 获取安全扫描报告
   */
  getSecurityScanReport(): string {
    return this.securityScanner.generateReport();
  }

  /**
   * 获取审计日志
   */
  async getAuditLogs(
    limit?: number,
    offset?: number,
    filter?: Partial<AuditEvent>
  ): Promise<AuditEvent[]> {
    if (!this.options.enableSecurityAudit) {
      return [];
    }
    return this.securityAuditManager.getAuditLogs(limit, offset, filter);
  }

  /**
   * 获取审计统计
   */
  async getAuditStats(): Promise<Record<string, number>> {
    if (!this.options.enableSecurityAudit) {
      return {};
    }
    return this.securityAuditManager.getAuditStats();
  }

  /**
   * 获取安全扫描器
   */
  getSecurityScanner(): SecurityScanner {
    return this.securityScanner;
  }

  /**
   * 获取安全审计管理器
   */
  getSecurityAuditManager(): SecurityAuditManager {
    return this.securityAuditManager;
  }

  /**
   * 获取权限管理器
   */
  getPermissionManager(): PermissionManager {
    return this.permissionManager;
  }

  /**
   * 获取细粒度权限管理器
   */
  getFineGrainedPermissionManager(): FineGrainedPermissionManager {
    return this.fineGrainedPermissionManager;
  }

  /**
   * 获取输入验证器
   */
  getInputValidator(): InputValidator {
    return this.inputValidator;
  }

  /**
   * 启用安全扫描
   */
  enableSecurityScan(): void {
    this.options.enableSecurityScan = true;
  }

  /**
   * 禁用安全扫描
   */
  disableSecurityScan(): void {
    this.options.enableSecurityScan = false;
  }

  /**
   * 启用安全审计
   */
  enableSecurityAudit(): void {
    this.options.enableSecurityAudit = true;
  }

  /**
   * 禁用安全审计
   */
  disableSecurityAudit(): void {
    this.options.enableSecurityAudit = false;
  }

  /**
   * 启用细粒度权限控制
   */
  enableFineGrainedPermissions(): void {
    this.options.enableFineGrainedPermissions = true;
  }

  /**
   * 禁用细粒度权限控制
   */
  disableFineGrainedPermissions(): void {
    this.options.enableFineGrainedPermissions = false;
  }

  /**
   * 检查是否启用安全扫描
   */
  isSecurityScanEnabled(): boolean {
    return this.options.enableSecurityScan!;
  }

  /**
   * 检查是否启用安全审计
   */
  isSecurityAuditEnabled(): boolean {
    return this.options.enableSecurityAudit!;
  }

  /**
   * 检查是否启用细粒度权限控制
   */
  isFineGrainedPermissionsEnabled(): boolean {
    return this.options.enableFineGrainedPermissions!;
  }
}

/**
 * 创建安全增强器实例
 */
export function createSecurityEnhancer(
  options: SecurityEnhancerOptions
): SecurityEnhancer {
  return new SecurityEnhancer(options);
}

/**
 * 全局安全增强器实例
 */
let globalSecurityEnhancer: SecurityEnhancer | null = null;

/**
 * 获取全局安全增强器
 */
export function getSecurityEnhancer(): SecurityEnhancer {
  if (!globalSecurityEnhancer) {
    throw new Error('Security enhancer not initialized');
  }
  return globalSecurityEnhancer;
}

/**
 * 初始化全局安全增强器
 */
export function initializeSecurityEnhancer(
  options: SecurityEnhancerOptions
): SecurityEnhancer {
  globalSecurityEnhancer = createSecurityEnhancer(options);
  return globalSecurityEnhancer;
}
