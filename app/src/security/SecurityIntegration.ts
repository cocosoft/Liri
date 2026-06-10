/**
 * 安全模块集成服务
 * 负责协调Security、Sandbox、Permission三个模块的集成
 */

import { BashSecurityAnalyzer } from './BashSecurityAnalyzer';
import { SecurityAnalysisResult, SecurityBehavior } from './types';
import { SandboxManager } from '@modules/sandbox';
import { PermissionManager } from './PermissionManager';
import { PermissionMode } from '@modules/permission';
import { configManager } from '@modules/config';
import type { PermissionConfig } from '@modules/config/types';
import { SecurityAudit } from './SecurityAudit';

/**
 * 安全决策结果
 */
export interface SecurityDecision {
  allowed: boolean;
  reason?: string;
  securityAnalysis?: SecurityAnalysisResult;
  sandboxRequired: boolean;
  permissionBehavior: 'allow' | 'deny' | 'ask';
}

/**
 * 安全集成服务
 */
export class SecurityIntegrationService {
  private securityAnalyzer: BashSecurityAnalyzer;
  private sandboxManager: SandboxManager;
  private permissionManager: PermissionManager;
  private permissionMode: PermissionMode;

  constructor() {
    this.securityAnalyzer = new BashSecurityAnalyzer();
    this.sandboxManager = SandboxManager.getInstance();
    this.permissionManager = PermissionManager.getInstance();
    this.permissionMode = 'default';
  }

  /**
   * 执行完整的安全检查
   * @param command 命令字符串
   * @param toolName 工具名称（可选）
   * @param input 工具输入（可选）
   * @param cwd 命令工作目录（可选），用于信任工作区检测
   * @returns 安全决策
   */
  async checkSecurity(
    command: string,
    toolName?: string,
    input?: Record<string, unknown>,
    cwd?: string
  ): Promise<SecurityDecision> {
    // 0. 检测工作目录是否在信任工作区内，获取信任级别
    let trustLevel: string | undefined;
    if (cwd) {
      trustLevel = this.getTrustLevelForPath(cwd);
    }

    // 1. 执行安全分析（传入信任级别以调整行为）
    const securityAnalysis = this.securityAnalyzer.analyze(command, trustLevel);

    // 1.1 审计日志：信任工作区放行记录
    if (trustLevel && cwd) {
      try {
        const audit = new SecurityAudit();
        audit.logWorkspaceTrustAllow(cwd, trustLevel, 'command_execution', command);
      } catch {
        // 审计日志非阻塞
      }
    }

    // 如果安全分析直接拒绝，直接返回
    if (securityAnalysis.behavior === 'deny') {
      return {
        allowed: false,
        reason: securityAnalysis.message || '安全检查拒绝',
        securityAnalysis,
        sandboxRequired: false,
        permissionBehavior: 'deny',
      };
    }

    // 2. 检查沙箱要求
    const sandboxRequired = this.sandboxManager.shouldUseSandbox({ command });

    // 3. 执行权限检查
    let permissionBehavior: 'allow' | 'deny' | 'ask' = 'allow';
    let permissionReason: string | undefined;

    if (toolName && input) {
      const allowed = this.permissionManager.checkToolPermission(
        toolName,
        input as Record<string, unknown>
      );
      if (allowed) {
        permissionBehavior = 'allow';
      } else {
        permissionBehavior = 'deny';
        permissionReason = '权限拒绝';
      }
    }

    // 综合决策
    let allowed = true;
    let reason: string[] = [];

    if (permissionBehavior === 'deny') {
      allowed = false;
      reason.push(permissionReason || '权限拒绝');
    }

    if (securityAnalysis.behavior === 'ask') {
      allowed = false;
      if (securityAnalysis.message) {
        reason.push(securityAnalysis.message);
      }
    }

    if (sandboxRequired && !this.sandboxManager.isSandboxingEnabled()) {
      allowed = false;
      reason.push('沙箱未启用');
    }

    return {
      allowed,
      reason: reason.length > 0 ? reason.join('; ') : undefined,
      securityAnalysis,
      sandboxRequired,
      permissionBehavior,
    };
  }

  /**
   * 设置权限模式
   * @param mode 权限模式
   */
  setPermissionMode(mode: PermissionMode): void {
    this.permissionMode = mode;
  }

  /**
   * 获取当前权限模式
   * @returns 权限模式
   */
  getPermissionMode(): PermissionMode {
    return this.permissionMode;
  }

  /**
   * 启用/禁用沙箱
   * @param enabled 是否启用
   */
  setSandboxEnabled(enabled: boolean): void {
    this.sandboxManager.updateSettings({ enabled });
  }

  /**
   * 检查沙箱是否启用
   * @returns 是否启用
   */
  isSandboxEnabled(): boolean {
    return this.sandboxManager.isSandboxingEnabled();
  }

  /**
   * 检查路径是否在信任的工作空间内
   * @param targetPath 待检查的路径
   * @returns 是否在信任工作空间内
   */
  isInTrustedWorkspace(targetPath: string): boolean {
    try {
      const permission = configManager.getConfigValue<PermissionConfig>('permission');
      const workspaces = permission?.trustedWorkspaces;
      if (!workspaces || workspaces.length === 0) return false;

      const normalizedPath = targetPath.replace(/\\/g, '/');
      return workspaces.some((ws) => {
        if (!ws.enabled) return false;
        const wsPath = ws.path.replace(/\\/g, '/');
        // 前缀匹配必须带路径分隔符或完全相等，防止 /proj 匹配 /proj-other
        return normalizedPath === wsPath || normalizedPath.startsWith(wsPath + '/');
      });
    } catch {
      return false;
    }
  }

  /**
   * 获取路径对应的信任级别
   * @param targetPath 待检查的路径
   * @returns 信任级别（chat/work/development），不在信任工作区内返回默认级别或 undefined
   */
  getTrustLevelForPath(targetPath: string): string | undefined {
    try {
      const permission = configManager.getConfigValue<PermissionConfig>('permission');
      const workspaces = permission?.trustedWorkspaces;
      if (workspaces && workspaces.length > 0) {
        const normalizedPath = targetPath.replace(/\\/g, '/');
        for (const ws of workspaces) {
          if (!ws.enabled) continue;
          const wsPath = ws.path.replace(/\\/g, '/');
          if (normalizedPath === wsPath || normalizedPath.startsWith(wsPath + '/')) {
            return ws.trustLevel || 'development';
          }
        }
      }

      // 无匹配工作区时，回退到全局默认信任级别（通过 --trust-level CLI 参数设置）
      return this.getDefaultTrustLevel();
    } catch {
      return undefined;
    }
  }

  /**
   * 获取全局默认信任级别
   * 优先级：permission.defaultTrustLevel（--trust-level CLI 参数）> undefined
   * @returns 默认信任级别或 undefined
   */
  getDefaultTrustLevel(): string | undefined {
    try {
      const permission = configManager.getConfigValue<PermissionConfig>('permission');
      const defaultTrustLevel = permission?.defaultTrustLevel;
      if (defaultTrustLevel && ['chat', 'work', 'development'].includes(defaultTrustLevel)) {
        return defaultTrustLevel;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * 获取安全分析器
   * @returns 安全分析器
   */
  getSecurityAnalyzer(): BashSecurityAnalyzer {
    return this.securityAnalyzer;
  }

  /**
   * 获取沙箱管理器
   * @returns 沙箱管理器
   */
  getSandboxManager(): SandboxManager {
    return this.sandboxManager;
  }

  /**
   * 获取权限管理器
   * @returns 权限管理器
   */
  getPermissionManager(): PermissionManager {
    return this.permissionManager;
  }

  /**
   * 获取安全状态摘要
   * @returns 状态摘要
   */
  getStatus(): {
    sandboxEnabled: boolean;
    permissionMode: PermissionMode;
    securityAnalyzerReady: boolean;
  } {
    return {
      sandboxEnabled: this.isSandboxEnabled(),
      permissionMode: this.getPermissionMode(),
      securityAnalyzerReady: true,
    };
  }
}

// 导出单例
export const securityIntegrationService = new SecurityIntegrationService();
