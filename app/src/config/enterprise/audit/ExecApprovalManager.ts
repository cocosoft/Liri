/**
 * ExecApprovalManager — 工具执行审批管理器
 *
 * 职责：桥接权限系统的 "ASK" 决策与企业版 ApprovalWorkflow。
 * 当权限检查返回 ASK 时，创建审批请求并等待人工批准/拒绝。
 *
 * 核心流程：
 *   1) 请求执行审批 → 创建 ApprovalRequest
 *   2) 等待审批结果（Promise 异步等待）
 *   3) 外部通过 approve/reject 方法批准或拒绝
 *   4) 超时自动拒绝
 *
 * 使用场景：
 *   - ToolExecutor 在 checkPermissions 收到 ASK 后调用
 *   - GovernanceManager 在权限检查环节拦截并等待审批
 *   - 外部审批 UI 通过 resolveApproval 操作审批
 */

import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';
import { ErrorCodes } from '@modules/error';
import { getLogger } from '../../../monitoring/logs/Logger.js';
const logger = getLogger('config:enterprise:audit:execApprovalManager');

/** 审批状态 */
export type ExecApprovalStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'timed_out';

/** 执行审批请求 */
export interface ExecApprovalRequest {
  /** 请求唯一 ID */
  id: string;
  /** 关联的工具执行 ID */
  toolUseId: string;
  /** 工具名称 */
  toolName: string;
  /** 工具输入参数 */
  input: Record<string, unknown>;
  /** 请求描述 */
  description: string;
  /** 请求人（或系统） */
  requester: string;
  /** 当前审批状态 */
  status: ExecApprovalStatus;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** 超时时间（毫秒时间戳） */
  timeoutAt: number;
  /** 审批决策详情 */
  decision?: {
    /** 审批人 */
    approvedBy: string;
    /** 审批时间 */
    approvedAt: number;
    /** 审批意见 */
    comment?: string;
  };
}

/** 审批管理器配置 */
export interface ExecApprovalManagerConfig {
  /** 默认审批超时（毫秒），默认 120 秒 */
  defaultTimeoutMs: number;
  /** 是否启用自动审批（调试用） */
  autoApprove: boolean;
  /** 是否启用日志 */
  verbose: boolean;
}

const DEFAULT_CONFIG: ExecApprovalManagerConfig = {
  defaultTimeoutMs: 120_000,
  autoApprove: false,
  verbose: true,
};

/** 审批事件类型 */
export type ExecApprovalEvent =
  | 'approval:created'
  | 'approval:approved'
  | 'approval:rejected'
  | 'approval:cancelled'
  | 'approval:timed_out';

/** 执行审批管理器 */
export class ExecApprovalManager {
  private requests: Map<string, ExecApprovalRequest> = new Map();
  private resolvers: Map<
    string,
    {
      resolve: (request: ExecApprovalRequest) => void;
      timeout: NodeJS.Timeout;
    }
  > = new Map();
  private config: ExecApprovalManagerConfig;
  private emitter: EventEmitter = new EventEmitter();

  constructor(config?: Partial<ExecApprovalManagerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 提交工具执行审批请求
   *
   * @param toolName  工具名称
   * @param input     工具输入参数
   * @param requester 请求人
   * @param description 审批描述
   * @param toolUseId 可选的工具执行 ID，不传则自动生成
   * @returns 返回一个 Promise，在审批完成（批准/拒绝/超时）时 resolve
   */
  async requestApproval(
    toolName: string,
    input: Record<string, unknown>,
    requester: string,
    description: string,
    toolUseId?: string
  ): Promise<ExecApprovalRequest> {
    const id = randomUUID();
    const now = Date.now();

    const request: ExecApprovalRequest = {
      id,
      toolUseId: toolUseId || id,
      toolName,
      input,
      description,
      requester,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      timeoutAt: now + this.config.defaultTimeoutMs,
    };

    this.requests.set(id, request);
    this.emitEvent('approval:created', request);

    if (this.config.autoApprove) {
      setImmediate(() => {
        this.approve(id, 'auto-approver', 'auto-approve mode').catch(
          (err) =>
            void handleError(err, {
              module: 'config:enterprise:exec',
              action: '自动审批失败',
            })
        );
      });
    }

    if (this.config.verbose) {
      logger.info(
        `[ExecApproval] 审批请求已提交: id=${id} tool=${toolName} requester=${requester}`
      );
    }

    const promise = new Promise<ExecApprovalRequest>((resolve) => {
      const timeout = setTimeout(() => {
        this.handleTimeout(id);
      }, this.config.defaultTimeoutMs);

      this.resolvers.set(id, { resolve, timeout });
    });

    return promise;
  }

  /**
   * 批准审批请求
   *
   * @param requestId  审批请求 ID
   * @param approvedBy 审批人
   * @param comment    审批意见
   * @returns 更新后的审批请求
   */
  async approve(
    requestId: string,
    approvedBy: string,
    comment?: string
  ): Promise<ExecApprovalRequest> {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new AppError(
        `ExecApprovalManager: 审批请求不存在 (requestId=${requestId})`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'ENTITY_NOT_FOUND',
        { requestId }
      );
    }

    if (request.status !== 'pending') {
      throw new AppError(
        `ExecApprovalManager: 审批请求不在待审批状态 (status=${request.status})`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'INVALID_STATE',
        { status: request.status }
      );
    }

    request.status = 'approved';
    request.updatedAt = Date.now();
    request.decision = {
      approvedBy,
      approvedAt: Date.now(),
      comment,
    };

    this.resolveRequest(requestId);
    this.emitEvent('approval:approved', request);

    if (this.config.verbose) {
      logger.info(
        `[ExecApproval] 审批已批准: id=${requestId} approvedBy=${approvedBy}`
      );
    }

    return request;
  }

  /**
   * 拒绝审批请求
   *
   * @param requestId  审批请求 ID
   * @param rejectedBy 审批人
   * @param comment    拒绝原因
   * @returns 更新后的审批请求
   */
  async reject(
    requestId: string,
    rejectedBy: string,
    comment?: string
  ): Promise<ExecApprovalRequest> {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new AppError(
        `ExecApprovalManager: 审批请求不存在 (requestId=${requestId})`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'ENTITY_NOT_FOUND',
        { requestId }
      );
    }

    if (request.status !== 'pending') {
      throw new AppError(
        `ExecApprovalManager: 审批请求不在待审批状态 (status=${request.status})`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'INVALID_STATE',
        { status: request.status }
      );
    }

    request.status = 'rejected';
    request.updatedAt = Date.now();
    request.decision = {
      approvedBy: rejectedBy,
      approvedAt: Date.now(),
      comment,
    };

    this.resolveRequest(requestId);
    this.emitEvent('approval:rejected', request);

    if (this.config.verbose) {
      logger.info(
        `[ExecApproval] 审批已拒绝: id=${requestId} rejectedBy=${rejectedBy}`
      );
    }

    return request;
  }

  /**
   * 取消审批请求
   *
   * @param requestId 审批请求 ID
   * @param reason    取消原因（可选）
   * @returns 更新后的审批请求
   */
  async cancel(
    requestId: string,
    reason?: string
  ): Promise<ExecApprovalRequest> {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new AppError(
        `ExecApprovalManager: 审批请求不存在 (requestId=${requestId})`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'ENTITY_NOT_FOUND',
        { requestId }
      );
    }

    if (request.status !== 'pending') {
      throw new AppError(
        `ExecApprovalManager: 审批请求不在待审批状态 (status=${request.status})`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'INVALID_STATE',
        { status: request.status }
      );
    }

    request.status = 'cancelled';
    request.updatedAt = Date.now();
    request.decision = {
      approvedBy: 'system',
      approvedAt: Date.now(),
      comment: reason || 'cancelled by system',
    };

    this.resolveRequest(requestId);
    this.emitEvent('approval:cancelled', request);

    if (this.config.verbose) {
      logger.info(
        `[ExecApproval] 审批已取消: id=${requestId} reason=${reason || 'N/A'}`
      );
    }

    return request;
  }

  /**
   * 获取审批请求详情
   *
   * @param requestId 审批请求 ID
   */
  getRequest(requestId: string): ExecApprovalRequest | undefined {
    return this.requests.get(requestId);
  }

  /**
   * 查询待审批列表
   *
   * @param filter 筛选条件
   * @returns 匹配的审批请求列表
   */
  queryPending(filter?: {
    toolName?: string;
    requester?: string;
  }): ExecApprovalRequest[] {
    let result = Array.from(this.requests.values()).filter(
      (r) => r.status === 'pending'
    );

    if (filter?.toolName) {
      result = result.filter((r) => r.toolName === filter.toolName);
    }

    if (filter?.requester) {
      result = result.filter((r) => r.requester === filter.requester);
    }

    return result.sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * 查询所有已完成的审批
   *
   * @returns 已完成的审批请求列表
   */
  queryCompleted(): ExecApprovalRequest[] {
    return Array.from(this.requests.values())
      .filter((r) => r.status !== 'pending')
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * 注册审批事件监听
   *
   * @param event    事件类型
   * @param listener 监听器
   */
  on(
    event: ExecApprovalEvent,
    listener: (request: ExecApprovalRequest) => void
  ): void {
    this.emitter.on(event, listener);
  }

  /**
   * 移除审批事件监听
   *
   * @param event    事件类型
   * @param listener 监听器
   */
  off(
    event: ExecApprovalEvent,
    listener: (request: ExecApprovalRequest) => void
  ): void {
    this.emitter.off(event, listener);
  }

  /**
   * 统计审批状态分布
   *
   * @returns 各状态的数量
   */
  stats(): {
    pending: number;
    approved: number;
    rejected: number;
    cancelled: number;
    timedOut: number;
    total: number;
  } {
    const all = Array.from(this.requests.values());

    return {
      pending: all.filter((r) => r.status === 'pending').length,
      approved: all.filter((r) => r.status === 'approved').length,
      rejected: all.filter((r) => r.status === 'rejected').length,
      cancelled: all.filter((r) => r.status === 'cancelled').length,
      timedOut: all.filter((r) => r.status === 'timed_out').length,
      total: all.length,
    };
  }

  /**
   * 清理历史记录
   *
   * @param maxAgeMs 最大保留时间（毫秒），默认 24 小时
   * @returns 清理的记录数
   */
  cleanup(maxAgeMs: number = 86_400_000): number {
    const cutoff = Date.now() - maxAgeMs;
    let count = 0;

    for (const [id, req] of this.requests) {
      if (req.updatedAt <= cutoff && req.status !== 'pending') {
        this.requests.delete(id);
        count++;
      }
    }

    if (this.config.verbose && count > 0) {
      logger.info(`[ExecApproval] 历史清理: 移除了 ${count} 条记录`);
    }

    return count;
  }

  /**
   * 更新配置（运行时）
   *
   * @param config 部分配置
   */
  updateConfig(config: Partial<ExecApprovalManagerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /** 处理超时 */
  private handleTimeout(requestId: string): void {
    const request = this.requests.get(requestId);
    if (!request || request.status !== 'pending') {
      return;
    }

    request.status = 'timed_out';
    request.updatedAt = Date.now();
    request.decision = {
      approvedBy: 'system',
      approvedAt: Date.now(),
      comment: `审批超时 (timeout=${this.config.defaultTimeoutMs}ms)`,
    };

    this.resolveRequest(requestId);
    this.emitEvent('approval:timed_out', request);

    if (this.config.verbose) {
      logger.warning(
        `[ExecApproval] 审批超时: id=${requestId} timeout=${this.config.defaultTimeoutMs}ms`
      );
    }
  }

  /** 解析等待中的 Promise */
  private resolveRequest(requestId: string): void {
    const entry = this.resolvers.get(requestId);
    if (entry) {
      clearTimeout(entry.timeout);
      const request = this.requests.get(requestId);
      entry.resolve(request!);
      this.resolvers.delete(requestId);
    }
  }

  /** 发射事件 */
  private emitEvent(
    event: ExecApprovalEvent,
    request: ExecApprovalRequest
  ): void {
    this.emitter.emit(event, request);
  }
}

/**
 * 创建执行审批管理器实例
 *
 * @param config 可选配置
 * @returns ExecApprovalManager 实例
 */
export function createExecApprovalManager(
  config?: Partial<ExecApprovalManagerConfig>
): ExecApprovalManager {
  return new ExecApprovalManager(config);
}
