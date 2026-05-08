/**
 * 安全模块集成服务
 * 负责协调Security、Sandbox、Permission三个模块的集成
 */

import { BashSecurityAnalyzer } from './BashSecurityAnalyzer';
import { SecurityAnalysisResult, SecurityBehavior } from './types';
import { SandboxManager } from '@modules/sandbox';
import { PermissionManager } from './PermissionManager';
import { PermissionMode } from '@modules/permission';

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
   * @returns 安全决策
   */
  async checkSecurity(
    command: string,
    toolName?: string,
    input?: Record<string, unknown>
  ): Promise<SecurityDecision> {
    // 1. 执行安全分析
    const securityAnalysis = this.securityAnalyzer.analyze(command);
    
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
      const allowed = this.permissionManager.checkToolPermission(toolName, input as Record<string, unknown>);
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