//
/**
 * Agent权限同步管理器
 * 负责在团队中同步和传播权限设置
 * 参考CC源码 cc_code/backend/utils/swarm/permissionSync.ts 实现
 */

import { logger } from '@modules/utils/log';

/**
 * 权限更新类型
 */
export type PermissionUpdateType = 'allow' | 'deny' | 'never_allow';

/**
 * 权限规则
 */
export interface PermissionRule {
  tool: string;
  type: PermissionUpdateType;
  reason?: string;
  createdAt: number;
}

/**
 * 权限上下文
 */
export interface PermissionContext {
  allowedPaths?: string[];
  deniedPaths?: string[];
  rules?: PermissionRule[];
  alwaysAllow?: string[];
  alwaysDeny?: string[];
}

/**
 * 团队权限同步消息
 */
export interface SwarmPermissionMessage {
  type: 'permission_request' | 'permission_response';
  id: string;
  workerId: string;
  workerName: string;
  workerColor?: string;
  teamName: string;
  toolName: string;
  toolUseId: string;
  description: string;
  input: Record<string, unknown>;
  status?: 'pending' | 'approved' | 'rejected';
  resolvedBy?: 'worker' | 'leader';
  feedback?: string;
  updatedInput?: Record<string, unknown>;
  permissionUpdates?: PermissionRule[];
  createdAt: number;
}

/**
 * 权限同步配置
 */
export interface PermissionSyncConfig {
  /** 是否启用权限同步 */
  enabled: boolean;
  /** 同步模式：immediate | batch | on_demand */
  syncMode: 'immediate' | 'batch' | 'on_demand';
  /** 批量同步间隔（毫秒） */
  batchIntervalMs: number;
  /** 是否继承leader权限 */
  inheritLeaderPermissions: boolean;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: PermissionSyncConfig = {
  enabled: true,
  syncMode: 'immediate',
  batchIntervalMs: 1000,
  inheritLeaderPermissions: true,
};

/**
 * 权限同步状态
 */
interface SyncState {
  pendingRequests: SwarmPermissionMessage[];
  lastSyncTime: number;
  syncInProgress: boolean;
}

/**
 * Agent权限同步管理器
 */
export class PermissionSyncManager {
  private config: PermissionSyncConfig;
  private syncState: SyncState = {
    pendingRequests: [],
    lastSyncTime: 0,
    syncInProgress: false,
  };
  private leaderContext: PermissionContext = {};
  private workerContexts: Map<string, PermissionContext> = new Map();
  private permissionListeners: Map<
    string,
    (message: SwarmPermissionMessage) => void
  > = new Map();

  constructor(config: Partial<PermissionSyncConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 设置Leader的权限上下文
   */
  setLeaderContext(context: PermissionContext): void {
    this.leaderContext = { ...context };
    logger.debug('Updated leader permission context');

    // 如果是立即同步模式，立即同步到所有worker
    if (this.config.syncMode === 'immediate') {
      this.syncToAllWorkers();
    }
  }

  /**
   * 获取Leader的权限上下文
   */
  getLeaderContext(): PermissionContext {
    return { ...this.leaderContext };
  }

  /**
   * 为Worker设置权限上下文
   */
  setWorkerContext(workerId: string, context: PermissionContext): void {
    this.workerContexts.set(workerId, { ...context });
    logger.debug(`Updated permission context for worker ${workerId}`);
  }

  /**
   * 获取Worker的权限上下文
   */
  getWorkerContext(workerId: string): PermissionContext | undefined {
    return this.workerContexts.get(workerId);
  }

  /**
   * 继承Leader权限到Worker
   */
  inheritLeaderToWorker(workerId: string): PermissionContext {
    if (!this.config.inheritLeaderPermissions) {
      return {};
    }

    const inheritedContext: PermissionContext = {
      allowedPaths: this.leaderContext.allowedPaths
        ? [...this.leaderContext.allowedPaths]
        : undefined,
      deniedPaths: this.leaderContext.deniedPaths
        ? [...this.leaderContext.deniedPaths]
        : undefined,
      rules: this.leaderContext.rules
        ? [...this.leaderContext.rules]
        : undefined,
      alwaysAllow: this.leaderContext.alwaysAllow
        ? [...this.leaderContext.alwaysAllow]
        : undefined,
      alwaysDeny: this.leaderContext.alwaysDeny
        ? [...this.leaderContext.alwaysDeny]
        : undefined,
    };

    this.setWorkerContext(workerId, inheritedContext);
    logger.debug(`Inherited leader permissions to worker ${workerId}`);

    return inheritedContext;
  }

  /**
   * 同步权限到所有Worker
   */
  syncToAllWorkers(): void {
    if (this.syncState.syncInProgress) {
      logger.debug('Sync already in progress, skipping');
      return;
    }

    this.syncState.syncInProgress = true;

    try {
      const workerIds = Array.from(this.workerContexts.keys());
      for (const workerId of workerIds) {
        if (this.config.inheritLeaderPermissions) {
          this.inheritLeaderToWorker(workerId);
        }
      }

      this.syncState.lastSyncTime = Date.now();
      logger.debug('Synced permissions to all workers');
    } finally {
      this.syncState.syncInProgress = false;
    }
  }

  /**
   * 创建权限请求
   */
  createPermissionRequest(
    workerId: string,
    workerName: string,
    toolName: string,
    toolUseId: string,
    description: string,
    input: Record<string, unknown>,
    teamName: string,
    workerColor?: string
  ): SwarmPermissionMessage {
    const message: SwarmPermissionMessage = {
      type: 'permission_request',
      id: `perm-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      workerId,
      workerName,
      workerColor,
      teamName,
      toolName,
      toolUseId,
      description,
      input,
      status: 'pending',
      createdAt: Date.now(),
    };

    this.syncState.pendingRequests.push(message);
    return message;
  }

  /**
   * 创建权限响应
   */
  createPermissionResponse(
    originalRequest: SwarmPermissionMessage,
    approved: boolean,
    feedback?: string,
    updatedInput?: Record<string, unknown>,
    permissionUpdates?: PermissionRule[]
  ): SwarmPermissionMessage {
    const response: SwarmPermissionMessage = {
      ...originalRequest,
      type: 'permission_response',
      status: approved ? 'approved' : 'rejected',
      resolvedBy: 'leader',
      feedback,
      updatedInput,
      permissionUpdates,
    };

    // 从待处理队列中移除
    this.syncState.pendingRequests = this.syncState.pendingRequests.filter(
      (m) => m.id !== originalRequest.id
    );

    return response;
  }

  /**
   * 获取待处理的权限请求
   */
  getPendingRequests(): SwarmPermissionMessage[] {
    return [...this.syncState.pendingRequests];
  }

  /**
   * 获取Worker的待处理请求
   */
  getWorkerPendingRequests(workerId: string): SwarmPermissionMessage[] {
    return this.syncState.pendingRequests.filter(
      (m) => m.workerId === workerId
    );
  }

  /**
   * 检查Worker是否有待处理的权限请求
   */
  hasPendingRequests(workerId?: string): boolean {
    if (workerId) {
      return this.syncState.pendingRequests.some(
        (m) => m.workerId === workerId
      );
    }
    return this.syncState.pendingRequests.length > 0;
  }

  /**
   * 注册权限消息监听器
   */
  addPermissionListener(
    workerId: string,
    listener: (message: SwarmPermissionMessage) => void
  ): void {
    this.permissionListeners.set(workerId, listener);
  }

  /**
   * 移除权限消息监听器
   */
  removePermissionListener(workerId: string): void {
    this.permissionListeners.delete(workerId);
  }

  /**
   * 通知权限消息
   */
  notifyPermissionMessage(message: SwarmPermissionMessage): void {
    const listener = this.permissionListeners.get(message.workerId);
    if (listener) {
      try {
        listener(message);
      } catch (error) {
        logger.error(
          `Error in permission listener for ${message.workerId}:`,
          error as Error
        );
      }
    }
  }

  /**
   * 添加权限规则
   */
  addRule(context: PermissionContext, rule: PermissionRule): void {
    if (!context.rules) {
      context.rules = [];
    }
    context.rules.push(rule);
  }

  /**
   * 检查工具是否被允许
   */
  isToolAllowed(context: PermissionContext, toolName: string): boolean {
    if (context.alwaysDeny?.includes(toolName)) {
      return false;
    }

    if (context.alwaysAllow?.includes(toolName)) {
      return true;
    }

    if (context.rules) {
      for (const rule of context.rules) {
        if (rule.tool === toolName) {
          return rule.type === 'allow';
        }
      }
    }

    return true; // 默认允许
  }

  /**
   * 清除Worker上下文
   */
  clearWorkerContext(workerId: string): void {
    this.workerContexts.delete(workerId);
    this.permissionListeners.delete(workerId);
    logger.debug(`Cleared permission context for worker ${workerId}`);
  }

  /**
   * 清除所有Worker上下文
   */
  clearAllWorkerContexts(): void {
    this.workerContexts.clear();
    this.permissionListeners.clear();
    this.syncState.pendingRequests = [];
    logger.debug('Cleared all worker permission contexts');
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<PermissionSyncConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取配置
   */
  getConfig(): PermissionSyncConfig {
    return { ...this.config };
  }

  /**
   * 获取同步状态
   */
  getSyncState(): {
    lastSyncTime: number;
    pendingCount: number;
    syncInProgress: boolean;
  } {
    return {
      lastSyncTime: this.syncState.lastSyncTime,
      pendingCount: this.syncState.pendingRequests.length,
      syncInProgress: this.syncState.syncInProgress,
    };
  }
}

/**
 * 导出单例
 */
export const permissionSyncManager = new PermissionSyncManager();

/**
 * 便捷函数：继承Leader权限
 */
export function inheritLeaderPermissions(workerId: string): PermissionContext {
  return permissionSyncManager.inheritLeaderToWorker(workerId);
}

/**
 * 便捷函数：检查工具权限
 */
export function checkToolPermission(
  context: PermissionContext,
  toolName: string
): boolean {
  return permissionSyncManager.isToolAllowed(context, toolName);
}
