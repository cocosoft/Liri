import { securityIntegrationService } from './SecurityIntegration';
import type { SecurityDecision } from './SecurityIntegration';
import type { BashSecurityAnalyzer } from './BashSecurityAnalyzer';
import type { PermissionManager } from './PermissionManager';
import type { SandboxManager } from '@modules/sandbox';
import type { PermissionMode } from '@modules/permission';
import {
  filterMcpServersByPolicy as filterMcpPolicy,
  doesEnterpriseMcpConfigExist as checkEnterpriseMcpConfig,
  checkResourcePermission as checkChannelResourcePerm,
  checkToolPermission as checkChannelToolPerm,
  isResourceAccessAllowed as isResourceAccessOk,
  isToolAccessAllowed as isToolAccessOk,
} from './policy';
import type { MCPServerPolicy, PermissionBehavior } from './policy';
import type { MemorySecretMatch } from './scanner/secret';
import {
  scanMemoryForSecrets,
  containsSecrets,
  sanitizeSecrets,
} from './scanner/secret';

export enum SecurityLevel {
  NONE = 0,
  LOW = 1,
  MEDIUM = 2,
  HIGH = 3,
  CRITICAL = 4,
}

export interface SecurityCheckResult {
  passed: boolean;
  level: SecurityLevel;
  category: string;
  details: string[];
  timestamp: number;
  suggestions?: string[];
}

export interface AuditRecord {
  id: string;
  sessionId: string;
  action: string;
  actor: string;
  target: string;
  result: 'allowed' | 'blocked' | 'flagged';
  level: SecurityLevel;
  details: string;
  timestamp: number;
}

export interface SecurityConfig {
  enabled: boolean;
  minLevel: SecurityLevel;
  maxInputLength: number;
  maxMessageCount: number;
  blockedPatterns: RegExp[];
  allowedDomains: string[];
  allowedFileTypes: string[];
  enableAuditLog: boolean;
  enableContentFilter: boolean;
  enableRateLimit: boolean;
  rateLimitMaxRequests: number;
  rateLimitWindowMs: number;
}

const defaultConfig: SecurityConfig = {
  enabled: true,
  minLevel: SecurityLevel.LOW,
  maxInputLength: 100000,
  maxMessageCount: 1000,
  blockedPatterns: [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    /DROP\s+TABLE/gi,
    /DELETE\s+FROM/gi,
    /process\.env/i,
    /process\.mainModule/i,
    /require\s*\(\s*['"]fs['"]\s*\)/i,
    /eval\s*\(/i,
  ],
  allowedDomains: [],
  allowedFileTypes: [
    '.txt',
    '.md',
    '.json',
    '.csv',
    '.ts',
    '.js',
    '.py',
    '.rs',
    '.go',
    '.yaml',
    '.yml',
  ],
  enableAuditLog: true,
  enableContentFilter: true,
  enableRateLimit: true,
  rateLimitMaxRequests: 100,
  rateLimitWindowMs: 60000,
};

export interface ICompleteSecuritySystem {
  checkMessageSecurity(
    content: string,
    context?: Record<string, unknown>
  ): Promise<SecurityCheckResult>;
  checkToolSecurity(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<SecurityCheckResult>;
  checkSessionSecurity(sessionId: string): Promise<SecurityCheckResult>;
  auditAction(record: Omit<AuditRecord, 'id' | 'timestamp'>): AuditRecord;
  getAuditLogs(filters?: Partial<AuditRecord>): AuditRecord[];
  getSecurityReport(): SecurityReport;
  updateConfig(config: Partial<SecurityConfig>): void;
  isRateLimited(sessionId: string): boolean;

  checkCommandSecurity(
    command: string,
    toolName?: string,
    input?: Record<string, unknown>,
    cwd?: string
  ): Promise<SecurityDecision>;

  /**
   * 检查路径是否在信任的工作空间内
   */
  isInTrustedWorkspace(targetPath: string): boolean;

  /**
   * 获取路径对应的信任级别
   */
  getTrustLevelForPath(targetPath: string): string | undefined;

  getSecurityAnalyzer(): BashSecurityAnalyzer;
  getPermissionManager(): PermissionManager;
  getSandboxManager(): SandboxManager;
  getStatus(): {
    sandboxEnabled: boolean;
    permissionMode: PermissionMode;
    securityAnalyzerReady: boolean;
  };
  /** 获取原生安全分析器降级状态 */
  getNativeStatus(): { degraded: boolean; reason: string | null };
  setPermissionMode(mode: PermissionMode): void;
  isSandboxEnabled(): boolean;
  setSandboxEnabled(enabled: boolean): void;

  // ==================== 策略管理 ====================

  filterMcpServersByPolicy(
    serverNames: string[],
    policy?: MCPServerPolicy
  ): string[];
  doesEnterpriseMcpConfigExist(): boolean;
  checkChannelResourcePermission(
    serverName: string,
    resourceUri: string
  ): PermissionBehavior;
  checkChannelToolPermission(
    serverName: string,
    toolName: string
  ): PermissionBehavior;
  isResourceAccessAllowed(serverName: string, resourceUri: string): boolean;
  isToolAccessAllowed(serverName: string, toolName: string): boolean;

  // ==================== 秘密扫描 ====================

  scanForSecrets(content: string): MemorySecretMatch[];
  containsSecrets(content: string): boolean;
  sanitizeSecrets(content: string, placeholder?: string): string;
}

export interface SecurityReport {
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  blockedActions: number;
  flaggedActions: number;
  totalAuditLogs: number;
  topThreats: Array<{ category: string; count: number }>;
  securityScore: number;
}

/**
 * 统一安全系统门面（编排层）
 *
 * 作为安全子系统的唯一对外入口，聚合以下能力：
 * - 内容级安全过滤（XSS、SQL注入等）→ 本类实现
 * - 会话安全检测（速率限制、风险行为追踪）→ 本类实现
 * - 审计日志管理 → 本类实现
 * - 安全报告生成 → 本类实现
 * - 命令级安全分析 → 委托给 SecurityIntegrationService
 * - 沙箱管理 → 委托给 SecurityIntegrationService
 * - 权限管理 → 委托给 SecurityIntegrationService
 * - MCP 服务器策略过滤 → 委托给 policy/MCPServerPolicy
 * - 通道权限管理 → 委托给 policy/ChannelPermission
 * - 秘密扫描（记忆/团队记忆）→ 委托给 scanner/secret
 *
 * 外部代码应仅通过 @modules/security 导入此类的单例 completeSecuritySystem，
 * 不应直接引用 SecurityIntegrationService 或其内部组件。
 */
export class CompleteSecuritySystem implements ICompleteSecuritySystem {
  private config: SecurityConfig;
  private auditLogs: AuditRecord[] = [];
  private checkHistory: SecurityCheckResult[] = [];
  private rateLimitMap: Map<string, { count: number; windowStart: number }> =
    new Map();
  private maxAuditLogs: number;
  private maxCheckHistory: number;

  constructor(
    customConfig?: Partial<SecurityConfig>,
    maxAuditLogs: number = 10000,
    maxCheckHistory: number = 5000
  ) {
    this.config = { ...defaultConfig, ...customConfig };
    this.maxAuditLogs = maxAuditLogs;
    this.maxCheckHistory = maxCheckHistory;
  }

  // ==================== 内容安全（本类实现） ====================

  async checkMessageSecurity(
    content: string,
    context?: Record<string, unknown>
  ): Promise<SecurityCheckResult> {
    if (!this.config.enabled) {
      return {
        passed: true,
        level: SecurityLevel.NONE,
        category: 'disabled',
        details: ['Security checks disabled'],
        timestamp: Date.now(),
      };
    }

    const issues: string[] = [];

    if (content.length > this.config.maxInputLength) {
      issues.push(
        `Input exceeds max length: ${content.length} > ${this.config.maxInputLength}`
      );
    }

    if (this.config.enableContentFilter) {
      for (const pattern of this.config.blockedPatterns) {
        if (pattern.test(content)) {
          issues.push(`Blocked pattern detected: ${pattern}`);
        }
      }
    }

    const level =
      issues.length === 0
        ? SecurityLevel.NONE
        : issues.length <= 1
          ? SecurityLevel.LOW
          : issues.length <= 3
            ? SecurityLevel.MEDIUM
            : SecurityLevel.HIGH;

    const result: SecurityCheckResult = {
      passed: issues.length === 0,
      level,
      category: issues.length === 0 ? 'clean' : 'content_filter',
      details: issues,
      timestamp: Date.now(),
      suggestions:
        issues.length > 0 ? ['Review and sanitize input content'] : undefined,
    };

    this.recordCheck(result);
    return result;
  }

  async checkToolSecurity(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<SecurityCheckResult> {
    const commandStr = JSON.stringify(args);

    const analysis = securityIntegrationService
      .getSecurityAnalyzer()
      .analyze(commandStr);

    const riskLevelMap: Record<string, SecurityLevel> = {
      low: SecurityLevel.LOW,
      medium: SecurityLevel.MEDIUM,
      high: SecurityLevel.CRITICAL,
    };

    const result: SecurityCheckResult = {
      passed: analysis.safe,
      level: analysis.safe
        ? SecurityLevel.NONE
        : (riskLevelMap[analysis.riskLevel] ?? SecurityLevel.CRITICAL),
      category: analysis.safe ? 'clean' : 'dangerous_tool',
      details:
        analysis.matchedPatterns.length > 0
          ? analysis.matchedPatterns.map(
              (p) => `Dangerous command detected: ${p}`
            )
          : analysis.message
            ? [analysis.message]
            : [],
      timestamp: Date.now(),
    };

    this.recordCheck(result);
    return result;
  }

  async checkSessionSecurity(sessionId: string): Promise<SecurityCheckResult> {
    const issues: string[] = [];

    if (this.config.enableRateLimit) {
      if (this.isRateLimited(sessionId)) {
        issues.push('Rate limit exceeded');
      }
    }

    const sessionLogs = this.auditLogs.filter((l) => l.sessionId === sessionId);
    const blockedCount = sessionLogs.filter(
      (l) => l.result === 'blocked'
    ).length;
    if (blockedCount > 10) {
      issues.push(`High number of blocked actions: ${blockedCount}`);
    }

    const result: SecurityCheckResult = {
      passed: issues.length === 0,
      level: blockedCount > 10 ? SecurityLevel.HIGH : SecurityLevel.LOW,
      category: issues.length > 0 ? 'session_risk' : 'clean',
      details: issues,
      timestamp: Date.now(),
    };

    this.recordCheck(result);
    return result;
  }

  auditAction(record: Omit<AuditRecord, 'id' | 'timestamp'>): AuditRecord {
    const audit: AuditRecord = {
      ...record,
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
    } as AuditRecord;

    if (this.config.enableAuditLog) {
      this.auditLogs.push(audit);
      if (this.auditLogs.length > this.maxAuditLogs) {
        this.auditLogs = this.auditLogs.slice(-this.maxAuditLogs);
      }
    }

    if (audit.result === 'blocked' || audit.result === 'flagged') {
      const key = record.sessionId || 'global';
      const window = this.rateLimitMap.get(key) || {
        count: 0,
        windowStart: Date.now(),
      };
      window.count++;
      this.rateLimitMap.set(key, window);
    }

    return audit;
  }

  getAuditLogs(filters?: Partial<AuditRecord>): AuditRecord[] {
    if (!filters) return [...this.auditLogs];

    return this.auditLogs.filter((log) => {
      const logRecord = log as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(filters)) {
        if (logRecord[key] !== value) return false;
      }
      return true;
    });
  }

  getSecurityReport(): SecurityReport {
    const totalChecks = this.checkHistory.length;
    const passedChecks = this.checkHistory.filter((c) => c.passed).length;
    const failedChecks = totalChecks - passedChecks;
    const blockedActions = this.auditLogs.filter(
      (l) => l.result === 'blocked'
    ).length;
    const flaggedActions = this.auditLogs.filter(
      (l) => l.result === 'flagged'
    ).length;

    const threatCounts = new Map<string, number>();
    for (const check of this.checkHistory) {
      if (!check.passed) {
        threatCounts.set(
          check.category,
          (threatCounts.get(check.category) || 0) + 1
        );
      }
    }
    const topThreats = [...threatCounts.entries()]
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([category, count]) => ({ category, count }));

    const securityScore =
      totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : 100;

    return {
      totalChecks,
      passedChecks,
      failedChecks,
      blockedActions,
      flaggedActions,
      totalAuditLogs: this.auditLogs.length,
      topThreats,
      securityScore,
    };
  }

  updateConfig(config: Partial<SecurityConfig>): void {
    this.config = { ...this.config, ...config };
  }

  isRateLimited(sessionId: string): boolean {
    if (!this.config.enableRateLimit) return false;

    const entry = this.rateLimitMap.get(sessionId);
    if (!entry) return false;

    const now = Date.now();
    if (now - entry.windowStart > this.config.rateLimitWindowMs) {
      this.rateLimitMap.set(sessionId, { count: 1, windowStart: now });
      return false;
    }

    return entry.count >= this.config.rateLimitMaxRequests;
  }

  // ==================== 命令安全（委托给 SecurityIntegrationService） ====================

  async checkCommandSecurity(
    command: string,
    toolName?: string,
    input?: Record<string, unknown>,
    cwd?: string
  ): Promise<SecurityDecision> {
    return securityIntegrationService.checkSecurity(
      command,
      toolName,
      input,
      cwd
    );
  }

  /**
   * 检查路径是否在信任的工作空间内
   */
  isInTrustedWorkspace(targetPath: string): boolean {
    return securityIntegrationService.isInTrustedWorkspace(targetPath);
  }

  /**
   * 获取路径对应的信任级别
   */
  getTrustLevelForPath(targetPath: string): string | undefined {
    return securityIntegrationService.getTrustLevelForPath(targetPath);
  }

  getSecurityAnalyzer(): BashSecurityAnalyzer {
    return securityIntegrationService.getSecurityAnalyzer();
  }

  getPermissionManager(): PermissionManager {
    return securityIntegrationService.getPermissionManager();
  }

  getSandboxManager(): SandboxManager {
    return securityIntegrationService.getSandboxManager();
  }

  getStatus(): {
    sandboxEnabled: boolean;
    permissionMode: PermissionMode;
    securityAnalyzerReady: boolean;
  } {
    return securityIntegrationService.getStatus();
  }

  /**
   * 获取原生安全分析器降级状态
   * 供 /security status 命令查询
   */
  getNativeStatus(): { degraded: boolean; reason: string | null } {
    return this.getSecurityAnalyzer().getNativeStatus();
  }

  setPermissionMode(mode: PermissionMode): void {
    securityIntegrationService.setPermissionMode(mode);
  }

  isSandboxEnabled(): boolean {
    return securityIntegrationService.isSandboxEnabled();
  }

  setSandboxEnabled(enabled: boolean): void {
    securityIntegrationService.setSandboxEnabled(enabled);
  }

  // ==================== 策略管理 ====================

  filterMcpServersByPolicy(
    serverNames: string[],
    policy?: MCPServerPolicy
  ): string[] {
    return filterMcpPolicy(serverNames, policy);
  }

  doesEnterpriseMcpConfigExist(): boolean {
    return checkEnterpriseMcpConfig();
  }

  checkChannelResourcePermission(
    serverName: string,
    resourceUri: string
  ): PermissionBehavior {
    return checkChannelResourcePerm(serverName, resourceUri);
  }

  checkChannelToolPermission(
    serverName: string,
    toolName: string
  ): PermissionBehavior {
    return checkChannelToolPerm(serverName, toolName);
  }

  isResourceAccessAllowed(serverName: string, resourceUri: string): boolean {
    return isResourceAccessOk(serverName, resourceUri);
  }

  isToolAccessAllowed(serverName: string, toolName: string): boolean {
    return isToolAccessOk(serverName, toolName);
  }

  // ==================== 秘密扫描 ====================

  scanForSecrets(content: string): MemorySecretMatch[] {
    return scanMemoryForSecrets(content);
  }

  containsSecrets(content: string): boolean {
    return containsSecrets(content);
  }

  sanitizeSecrets(content: string, placeholder?: string): string {
    return sanitizeSecrets(content, placeholder);
  }

  // ==================== 私有方法 ====================

  private recordCheck(result: SecurityCheckResult): void {
    this.checkHistory.push(result);
    if (this.checkHistory.length > this.maxCheckHistory) {
      this.checkHistory = this.checkHistory.slice(-this.maxCheckHistory);
    }
  }
}

export const completeSecuritySystem = new CompleteSecuritySystem();
