/**
 * ApprovalWorkflow — 企业版审批工作流
 *
 * 支持多级审批、自动升级、SLA 监控、审批策略配置。
 * 适用于敏感操作（删除数据、批量执行、生产环境变更等）的审批流程。
 */

import { randomUUID } from 'crypto';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { ErrorCodes } from '@modules/error';
import { Logger, LogLevel } from '../../../monitoring/logs/Logger.js';

const logger = new Logger({
  module: 'config:enterprise:audit:approvalWorkflow',
  level: LogLevel.INFO,
});

/** 审批状态 */
export type ApprovalStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'escalated'
  | 'expired'
  | 'cancelled';

/** 审批级别 */
export type ApprovalLevel = 'level1' | 'level2' | 'level3';

/** 审批操作类型 */
export type ApprovalAction =
  | 'tool_execution'
  | 'data_deletion'
  | 'config_change'
  | 'batch_execution'
  | 'production_deploy'
  | 'user_role_change';

/** 审批请求 */
export interface ApprovalRequest {
  /** 请求 ID */
  id: string;
  /** 操作类型 */
  action: ApprovalAction;
  /** 请求人 */
  requester: string;
  /** 请求人角色 */
  requesterRole: string;
  /** 请求描述 */
  description: string;
  /** 请求详情 */
  details: Record<string, unknown>;
  /** 当前审批级别 */
  currentLevel: ApprovalLevel;
  /** 审批状态 */
  status: ApprovalStatus;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** SLA 截止时间 */
  slaDeadline: number;
  /** 审批记录 */
  approvals: ApprovalRecord[];
  /** 关联会话 */
  sessionId?: string;
  /** 关联租户 */
  tenant?: string;
}

/** 审批记录 */
export interface ApprovalRecord {
  /** 审批人 */
  approver: string;
  /** 审批人角色 */
  approverRole: string;
  /** 审批级别 */
  level: ApprovalLevel;
  /** 审批结果 */
  decision: 'approved' | 'rejected';
  /** 审批意见 */
  comment?: string;
  /** 审批时间 */
  timestamp: number;
}

/** 审批策略 */
export interface ApprovalPolicy {
  /** 操作类型 */
  action: ApprovalAction;
  /** 所需批准数 */
  requiredApprovals: number;
  /** 所需审批级别 */
  requiredLevel: ApprovalLevel;
  /** 是否允许自审批 */
  allowSelfApproval: boolean;
  /** SLA 时间（毫秒） */
  slaMs: number;
  /** 升级延迟（毫秒） */
  escalationDelayMs: number;
}

/** 审批人配置 */
export interface ApproverConfig {
  /** 审批级别 */
  level: ApprovalLevel;
  /** 审批人列表 */
  approvers: string[];
}

/** 审批工作流配置 */
export interface ApprovalWorkflowConfig {
  /** 审批人配置 */
  approvers: ApproverConfig[];
  /** 默认策略 */
  defaultPolicy?: ApprovalPolicy;
  /** 自定义策略 */
  policies?: ApprovalPolicy[];
  /** 是否启用自动升级 */
  enableEscalation?: boolean;
}

const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = {
  action: 'tool_execution',
  requiredApprovals: 1,
  requiredLevel: 'level1',
  allowSelfApproval: false,
  slaMs: 3600000,
  escalationDelayMs: 1800000,
};

const LEVEL_HIERARCHY: ApprovalLevel[] = ['level1', 'level2', 'level3'];

/** 升级事件 */
export interface EscalationEvent {
  requestId: string;
  fromLevel: ApprovalLevel;
  toLevel: ApprovalLevel;
  reason: string;
  timestamp: number;
}

/**
 * 企业版审批工作流
 */
export class ApprovalWorkflow {
  private requests: Map<string, ApprovalRequest> = new Map();
  private policies: Map<ApprovalAction, ApprovalPolicy> = new Map();
  private approvers: Map<ApprovalLevel, string[]> = new Map();
  private config: Required<ApprovalWorkflowConfig>;
  private escalationTimers: Map<string, NodeJS.Timeout> = new Map();
  private escalationListeners: Array<(event: EscalationEvent) => void> = [];

  constructor(config: ApprovalWorkflowConfig) {
    this.config = {
      ...config,
      defaultPolicy: config.defaultPolicy || DEFAULT_APPROVAL_POLICY,
      enableEscalation: config.enableEscalation ?? true,
      policies: config.policies || [],
    };

    for (const a of config.approvers) {
      this.approvers.set(a.level, a.approvers);
    }

    if (config.policies) {
      for (const p of config.policies) {
        this.policies.set(p.action, p);
      }
    }
  }

  /**
   * 提交审批请求
   */
  async submit(
    request: Omit<
      ApprovalRequest,
      | 'id'
      | 'status'
      | 'createdAt'
      | 'updatedAt'
      | 'slaDeadline'
      | 'approvals'
      | 'currentLevel'
    >
  ): Promise<ApprovalRequest> {
    const policy =
      this.policies.get(request.action) || this.config.defaultPolicy;

    const approvalRequest: ApprovalRequest = {
      ...request,
      id: randomUUID(),
      status: 'pending',
      currentLevel: policy.requiredLevel,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      slaDeadline: Date.now() + policy.slaMs,
      approvals: [],
    };

    this.requests.set(approvalRequest.id, approvalRequest);

    logger.info(`审批请求已提交: ${approvalRequest.id} (${request.action})`);

    this.scheduleEscalation(approvalRequest, policy);

    return approvalRequest;
  }

  /**
   * 审批请求（批准/拒绝）
   */
  async decide(
    requestId: string,
    approver: string,
    approverRole: string,
    decision: 'approved' | 'rejected',
    comment?: string
  ): Promise<ApprovalRequest> {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new AppError(
        ErrorCodes.ENTITY_NOT_FOUND.message,
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'APPROVAL_NOT_FOUND',
        { requestId }
      );
    }

    if (request.status !== 'pending') {
      throw new AppError(
        ErrorCodes.INVALID_STATE.message,
        ErrorCategory.VALIDATION,
        ErrorSeverity.MEDIUM,
        'APPROVAL_INVALID_STATUS',
        { status: request.status }
      );
    }

    const policy =
      this.policies.get(request.action) || this.config.defaultPolicy;

    if (!policy.allowSelfApproval && approver === request.requester) {
      throw new AppError(
        ErrorCodes.AUTH_INSUFFICIENT_PERMISSIONS.message,
        ErrorCategory.PERMISSION,
        ErrorSeverity.HIGH,
        'APPROVAL_SELF_NOT_ALLOWED',
        { approver, requester: request.requester }
      );
    }

    const levelApprovers = this.approvers.get(request.currentLevel) || [];
    if (!levelApprovers.includes(approver)) {
      throw new AppError(
        ErrorCodes.AUTH_INSUFFICIENT_PERMISSIONS.message,
        ErrorCategory.PERMISSION,
        ErrorSeverity.HIGH,
        'APPROVAL_NOT_AUTHORIZED',
        { approver, level: request.currentLevel }
      );
    }

    if (request.approvals.some((a) => a.approver === approver)) {
      throw new AppError(
        ErrorCodes.INVALID_STATE.message,
        ErrorCategory.VALIDATION,
        ErrorSeverity.MEDIUM,
        'APPROVAL_ALREADY_DECIDED',
        { approver }
      );
    }

    const record: ApprovalRecord = {
      approver,
      approverRole,
      level: request.currentLevel,
      decision,
      comment,
      timestamp: Date.now(),
    };

    request.approvals.push(record);

    if (decision === 'rejected') {
      request.status = 'rejected';
      request.updatedAt = Date.now();
      this.clearEscalationTimer(requestId);
      logger.info(`审批请求已拒绝: ${requestId} (${approver})`);
      return request;
    }

    const approvedCount = request.approvals.filter(
      (a) => a.decision === 'approved' && a.level === request.currentLevel
    ).length;

    if (approvedCount >= policy.requiredApprovals) {
      const currentLevelIndex = LEVEL_HIERARCHY.indexOf(request.currentLevel);
      const requiredLevelIndex = LEVEL_HIERARCHY.indexOf(policy.requiredLevel);

      if (currentLevelIndex >= requiredLevelIndex) {
        request.status = 'approved';
        request.updatedAt = Date.now();
        this.clearEscalationTimer(requestId);
        logger.info(`审批请求已通过: ${requestId}`);
      }
    }

    request.updatedAt = Date.now();
    return request;
  }

  /**
   * 手动升级审批级别
   */
  async escalate(requestId: string, reason: string): Promise<ApprovalRequest> {
    const request = this.requests.get(requestId);
    if (!request)
      throw new AppError(
        ErrorCodes.ENTITY_NOT_FOUND.message,
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'APPROVAL_NOT_FOUND',
        { requestId }
      );

    const currentIndex = LEVEL_HIERARCHY.indexOf(request.currentLevel);
    if (currentIndex >= LEVEL_HIERARCHY.length - 1) {
      throw new AppError(
        ErrorCodes.INVALID_STATE.message,
        ErrorCategory.VALIDATION,
        ErrorSeverity.MEDIUM,
        'APPROVAL_CANNOT_ESCALATE',
        { currentLevel: request.currentLevel }
      );
    }

    const prevLevel = request.currentLevel;
    request.currentLevel = LEVEL_HIERARCHY[currentIndex + 1];
    request.status = 'pending';
    request.updatedAt = Date.now();

    const event: EscalationEvent = {
      requestId,
      fromLevel: prevLevel,
      toLevel: request.currentLevel,
      reason,
      timestamp: Date.now(),
    };

    for (const listener of this.escalationListeners) {
      listener(event);
    }

    const policy =
      this.policies.get(request.action) || this.config.defaultPolicy;
    this.scheduleEscalation(request, policy);

    logger.info(
      `审批已升级: ${requestId} ${prevLevel} → ${request.currentLevel}`
    );
    return request;
  }

  /**
   * 取消审批
   */
  async cancel(requestId: string, actor: string): Promise<ApprovalRequest> {
    const request = this.requests.get(requestId);
    if (!request)
      throw new AppError(
        ErrorCodes.ENTITY_NOT_FOUND.message,
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'APPROVAL_NOT_FOUND',
        { requestId }
      );

    if (actor !== request.requester) {
      throw new AppError(
        ErrorCodes.AUTH_INSUFFICIENT_PERMISSIONS.message,
        ErrorCategory.PERMISSION,
        ErrorSeverity.HIGH,
        'APPROVAL_CANCEL_NOT_ALLOWED',
        { actor, requester: request.requester }
      );
    }

    if (request.status !== 'pending') {
      throw new AppError(
        ErrorCodes.INVALID_STATE.message,
        ErrorCategory.VALIDATION,
        ErrorSeverity.MEDIUM,
        'APPROVAL_CANNOT_CANCEL',
        { status: request.status }
      );
    }

    request.status = 'cancelled';
    request.updatedAt = Date.now();
    this.clearEscalationTimer(requestId);

    logger.info(`审批已取消: ${requestId}`);
    return request;
  }

  /**
   * 获取请求状态
   */
  getRequest(requestId: string): ApprovalRequest | undefined {
    return this.requests.get(requestId);
  }

  /**
   * 查询请求列表
   */
  query(filter?: {
    status?: ApprovalStatus;
    requester?: string;
    action?: ApprovalAction;
    tenant?: string;
  }): ApprovalRequest[] {
    let result = Array.from(this.requests.values());

    if (filter?.status)
      result = result.filter((r) => r.status === filter.status);
    if (filter?.requester)
      result = result.filter((r) => r.requester === filter.requester);
    if (filter?.action)
      result = result.filter((r) => r.action === filter.action);
    if (filter?.tenant)
      result = result.filter((r) => r.tenant === filter.tenant);

    return result.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * 注册升级事件监听
   */
  onEscalation(listener: (event: EscalationEvent) => void): void {
    this.escalationListeners.push(listener);
  }

  private scheduleEscalation(
    request: ApprovalRequest,
    policy: ApprovalPolicy
  ): void {
    this.clearEscalationTimer(request.id);

    if (!this.config.enableEscalation) return;

    const currentIndex = LEVEL_HIERARCHY.indexOf(request.currentLevel);
    if (currentIndex >= LEVEL_HIERARCHY.length - 1) return;

    const remaining = request.slaDeadline - Date.now();
    if (remaining <= 0) return;

    const timer = setTimeout(
      () => {
        if (request.status === 'pending') {
          const reason = 'SLA 超时，自动升级审批级别';
          this.escalate(request.id, reason).catch((err) =>
            logger.error('自动升级失败', err)
          );
        }
      },
      Math.min(policy.escalationDelayMs, remaining)
    );

    this.escalationTimers.set(request.id, timer);
  }

  private clearEscalationTimer(requestId: string): void {
    const timer = this.escalationTimers.get(requestId);
    if (timer) {
      clearTimeout(timer);
      this.escalationTimers.delete(requestId);
    }
  }

  /**
   * 清理已完成的请求
   */
  cleanup(maxAgeMs: number = 86400000): number {
    const cutoff = Date.now() - maxAgeMs;
    let count = 0;
    for (const [id, req] of this.requests) {
      if (
        req.createdAt < cutoff &&
        (req.status === 'approved' ||
          req.status === 'rejected' ||
          req.status === 'cancelled')
      ) {
        this.clearEscalationTimer(id);
        this.requests.delete(id);
        count++;
      }
    }
    return count;
  }
}
