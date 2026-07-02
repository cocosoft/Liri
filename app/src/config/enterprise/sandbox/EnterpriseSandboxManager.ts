/**
 * EnterpriseSandboxManager — 企业版沙箱管理器
 *
 * 基于现有沙箱系统之上，提供企业级特性：
 * - 策略驱动的沙箱配置
 * - 审计日志集成（自动记录沙箱违规）
 * - 多租户隔离
 * - 资源配额管理
 * - 沙箱安全评估
 */

import { randomUUID } from 'crypto';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { Logger, LogLevel } from '@modules/monitoring';
import { ErrorCodes } from '@modules/error';
import {
  EnterpriseAuditService,
  AuditEventType,
} from '../audit/EnterpriseAuditService.js';
import {
  SandboxPolicy,
  type PolicyRule,
  type PolicyDecision,
  type SandboxPolicyConfig,
} from './SandboxPolicy.js';
import type {
  SandboxConfig,
  SandboxExecuteOptions,
  SandboxExecuteResult,
} from '../../../sandbox/SandboxTypes.js';

const logger = new Logger({
  module: 'config:enterprise:sandbox:enterpriseSandboxManager',
  level: LogLevel.INFO,
});

/** 沙箱实例状态 */
export type SandboxStatus =
  | 'creating'
  | 'running'
  | 'paused'
  | 'stopped'
  | 'error';

/** 沙箱实例 */
export interface SandboxInstance {
  /** 实例 ID */
  id: string;
  /** 所属租户 */
  tenant: string;
  /** 所属用户 */
  owner: string;
  /** 关联策略名称 */
  policyName: string;
  /** 状态 */
  status: SandboxStatus;
  /** 创建时间 */
  createdAt: number;
  /** 上次活动时间 */
  lastActivityAt: number;
  /** 资源配额 */
  quotas: SandboxQuotas;
  /** 资源使用量 */
  usage: SandboxUsage;
  /** 标签 */
  tags: Record<string, string>;
}

/** 沙箱资源配额 */
export interface SandboxQuotas {
  /** CPU 核心数上限 */
  maxCpu: number;
  /** 内存上限（MB） */
  maxMemory: number;
  /** 磁盘上限（MB） */
  maxDisk: number;
  /** 网络带宽上限（Mbps） */
  maxBandwidth: number;
  /** 最大进程数 */
  maxProcesses: number;
  /** 最大运行时间（毫秒） */
  maxExecutionTime: number;
}

/** 沙箱资源使用量 */
export interface SandboxUsage {
  /** 已用 CPU 时间（毫秒） */
  cpuTime: number;
  /** 已用内存（MB） */
  memory: number;
  /** 已用磁盘（MB） */
  disk: number;
  /** 已用带宽（MB） */
  bandwidth: number;
  /** 活跃进程数 */
  activeProcesses: number;
}

/** 沙箱违规记录 */
export interface SandboxViolation {
  /** 违规 ID */
  id: string;
  /** 沙箱 ID */
  sandboxId: string;
  /** 租户 */
  tenant: string;
  /** 用户 */
  user: string;
  /** 违规类型 */
  type:
    | 'resource_exceeded'
    | 'policy_denied'
    | 'isolation_break'
    | 'timeout'
    | 'unauthorized_access';
  /** 违规详情 */
  details: string;
  /** 时间 */
  timestamp: number;
  /** 是否已处理 */
  resolved: boolean;
}

/** 企业沙箱管理器配置 */
export interface EnterpriseSandboxConfig {
  /** 默认配额 */
  defaultQuotas?: SandboxQuotas;
  /** 默认策略名称 */
  defaultPolicyName?: string;
  /** 是否启用审计 */
  enableAudit?: boolean;
}

const DEFAULT_QUOTAS: SandboxQuotas = {
  maxCpu: 2,
  maxMemory: 1024,
  maxDisk: 5120,
  maxBandwidth: 100,
  maxProcesses: 50,
  maxExecutionTime: 300000,
};

/**
 * 企业版沙箱管理器
 */
export class EnterpriseSandboxManager {
  private instances: Map<string, SandboxInstance> = new Map();
  private violations: SandboxViolation[] = [];
  private policies: Map<string, SandboxPolicy> = new Map();
  private audit: EnterpriseAuditService;
  private config: Required<EnterpriseSandboxConfig>;
  private maxViolations = 10000;

  constructor(config: EnterpriseSandboxConfig = {}) {
    this.config = {
      defaultQuotas: config.defaultQuotas || DEFAULT_QUOTAS,
      defaultPolicyName: config.defaultPolicyName || 'default',
      enableAudit: config.enableAudit ?? true,
    };
    this.audit = EnterpriseAuditService.getInstance();
  }

  /**
   * 注册沙箱策略
   */
  registerPolicy(policy: SandboxPolicy): void {
    this.policies.set(policy.name, policy);
    logger.info(`沙箱策略已注册: ${policy.name}`);
  }

  /**
   * 创建沙箱实例
   */
  async createInstance(
    tenant: string,
    owner: string,
    options?: {
      policyName?: string;
      quotas?: Partial<SandboxQuotas>;
      tags?: Record<string, string>;
    }
  ): Promise<SandboxInstance> {
    const policyName = options?.policyName || this.config.defaultPolicyName;
    const policy = this.policies.get(policyName);
    if (!policy) {
      throw new AppError(
        ErrorCodes.ENTITY_NOT_FOUND.message,
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'SANDBOX_POLICY_NOT_FOUND',
        { policyName }
      );
    }

    const instance: SandboxInstance = {
      id: randomUUID(),
      tenant,
      owner,
      policyName,
      status: 'creating',
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      quotas: {
        ...this.config.defaultQuotas,
        ...options?.quotas,
      },
      usage: {
        cpuTime: 0,
        memory: 0,
        disk: 0,
        bandwidth: 0,
        activeProcesses: 0,
      },
      tags: options?.tags || {},
    };

    instance.status = 'running';
    this.instances.set(instance.id, instance);

    if (this.config.enableAudit) {
      await this.audit.log(
        AuditEventType.SANDBOX_VIOLATION,
        'info',
        owner,
        'sandbox.create',
        {
          details: { sandboxId: instance.id, policy: policyName, tenant },
          resource: `sandbox/${instance.id}`,
          tenant,
        }
      );
    }

    logger.info(`沙箱实例已创建: ${instance.id} (${tenant}/${owner})`);
    return instance;
  }

  /**
   * 获取沙箱实例
   */
  getInstance(instanceId: string): SandboxInstance | undefined {
    return this.instances.get(instanceId);
  }

  /**
   * 查询沙箱实例
   */
  queryInstances(filter?: {
    tenant?: string;
    owner?: string;
    status?: SandboxStatus;
  }): SandboxInstance[] {
    let result = Array.from(this.instances.values());
    if (filter?.tenant)
      result = result.filter((i) => i.tenant === filter.tenant);
    if (filter?.owner) result = result.filter((i) => i.owner === filter.owner);
    if (filter?.status)
      result = result.filter((i) => i.status === filter.status);
    return result.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * 销毁沙箱实例
   */
  async destroyInstance(instanceId: string, actor: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance)
      throw new AppError(
        ErrorCodes.ENTITY_NOT_FOUND.message,
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'SANDBOX_INSTANCE_NOT_FOUND',
        { instanceId }
      );

    instance.status = 'stopped';
    this.instances.delete(instanceId);

    if (this.config.enableAudit) {
      await this.audit.log(
        AuditEventType.SYSTEM_CHANGE,
        'info',
        actor,
        'sandbox.destroy',
        {
          details: { sandboxId: instanceId, tenant: instance.tenant },
          resource: `sandbox/${instanceId}`,
          tenant: instance.tenant,
        }
      );
    }

    logger.info(`沙箱实例已销毁: ${instanceId}`);
  }

  /**
   * 检查操作是否允许（根据关联策略）
   */
  async checkPermission(
    instanceId: string,
    operation: string,
    context: Record<string, unknown>
  ): Promise<PolicyDecision> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      return { allowed: false, reason: '沙箱实例不存在' };
    }

    const policy = this.policies.get(instance.policyName);
    if (!policy) {
      return {
        allowed: false,
        reason: `沙箱策略未找到: ${instance.policyName}`,
      };
    }

    instance.lastActivityAt = Date.now();
    return policy.evaluate(operation, {
      ...context,
      sandboxId: instanceId,
      tenant: instance.tenant,
      owner: instance.owner,
    });
  }

  /**
   * 记录沙箱违规
   */
  async recordViolation(
    violation: Omit<SandboxViolation, 'id' | 'timestamp' | 'resolved'>
  ): Promise<SandboxViolation> {
    const record: SandboxViolation = {
      ...violation,
      id: randomUUID(),
      timestamp: Date.now(),
      resolved: false,
    };

    this.violations.push(record);
    if (this.violations.length > this.maxViolations) {
      this.violations = this.violations.slice(-this.maxViolations);
    }

    if (this.config.enableAudit) {
      await this.audit.log(
        AuditEventType.SANDBOX_VIOLATION,
        'warning',
        violation.user,
        'sandbox.violation',
        {
          details: {
            sandboxId: violation.sandboxId,
            type: violation.type,
            details: violation.details,
          },
          resource: `sandbox/${violation.sandboxId}`,
          tenant: violation.tenant,
          success: false,
          failureReason: violation.details,
        }
      );
    }

    logger.info(
      `沙箱违规: ${violation.sandboxId} [${violation.type}] ${violation.details}`
    );
    return record;
  }

  /**
   * 查询违规记录
   */
  queryViolations(filter?: {
    sandboxId?: string;
    tenant?: string;
    resolved?: boolean;
  }): SandboxViolation[] {
    let result = [...this.violations];
    if (filter?.sandboxId)
      result = result.filter((v) => v.sandboxId === filter.sandboxId);
    if (filter?.tenant)
      result = result.filter((v) => v.tenant === filter.tenant);
    if (filter?.resolved !== undefined)
      result = result.filter((v) => v.resolved === filter.resolved);
    return result.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * 标记违规已处理
   */
  async resolveViolation(violationId: string, actor: string): Promise<void> {
    const violation = this.violations.find((v) => v.id === violationId);
    if (!violation)
      throw new AppError(
        ErrorCodes.ENTITY_NOT_FOUND.message,
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'VIOLATION_NOT_FOUND',
        { violationId }
      );
    violation.resolved = true;

    if (this.config.enableAudit) {
      await this.audit.log(
        AuditEventType.SANDBOX_VIOLATION,
        'info',
        actor,
        'sandbox.violation.resolve',
        {
          details: { violationId },
          tenant: violation.tenant,
        }
      );
    }
  }

  /**
   * 获取资源使用统计
   */
  getUsageStats(): {
    totalInstances: number;
    totalViolations: number;
    activeInstances: number;
    byTenant: Record<string, number>;
  } {
    const byTenant: Record<string, number> = {};
    let activeInstances = 0;

    for (const inst of this.instances.values()) {
      byTenant[inst.tenant] = (byTenant[inst.tenant] || 0) + 1;
      if (inst.status === 'running') activeInstances++;
    }

    return {
      totalInstances: this.instances.size,
      totalViolations: this.violations.length,
      activeInstances,
      byTenant,
    };
  }
}
