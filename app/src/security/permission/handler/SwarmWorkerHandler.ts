/**
 * Swarm Worker Handler
 * 对标CC源码 permission/handler/swarmWorkerHandler.ts
 * Swarm Worker处理器，管理子Agent/Worker的权限委托与隔离
 */

import { logger } from '../../../utils/log.js';
import type {
  PermissionContext,
  PermissionDecision,
} from '../PermissionContext.js';
import { globalAuditLogger } from '../logging/PermissionAuditLogger.js';

export interface SwarmWorkerIdentity {
  workerId: string;
  parentSessionId?: string;
  workerType: 'sub_agent' | 'tool_worker' | 'sandbox' | 'parallel';
  trustLevel: 'full' | 'restricted' | 'isolated';
  allowedActions: string[];
  resourceQuota?: {
    maxCpu?: number;
    maxMemory?: number;
    maxFileSize?: number;
    maxNetworkRequests?: number;
  };
}

export interface SwarmPermissionContext {
  worker: SwarmWorkerIdentity;
  inheritedRoles: string[];
  parentDecision?: PermissionDecision;
  isolationLevel: 'none' | 'readonly' | 'sandbox' | 'full_isolation';
}

export class SwarmWorkerHandler {
  private workers: Map<string, SwarmWorkerIdentity> = new Map();
  private delegatedPermissions: Map<string, Set<string>> = new Map();

  registerWorker(identity: SwarmWorkerIdentity): void {
    this.workers.set(identity.workerId, identity);
    this.delegatedPermissions.set(identity.workerId, new Set());

    logger.info(
      `[SwarmWorkerHandler] Worker registered: ${identity.workerId} (type: ${identity.workerType}, trust: ${identity.trustLevel})`
    );
  }

  unregisterWorker(workerId: string): void {
    this.workers.delete(workerId);
    this.delegatedPermissions.delete(workerId);
    logger.info(`[SwarmWorkerHandler] Worker unregistered: ${workerId}`);
  }

  delegatePermission(
    workerId: string,
    action: string,
    context: PermissionContext
  ): PermissionDecision {
    const worker = this.workers.get(workerId);
    if (!worker) {
      return {
        allowed: false,
        riskLevel: 'high',
        behavior: 'deny',
        reason: `Worker ${workerId} not registered`,
        decidedBy: 'system',
        decidedAt: new Date(),
        constraints: [],
      };
    }

    if (worker.trustLevel === 'full') {
      return {
        allowed: true,
        riskLevel: context.action.estimatedRisk ?? 'low',
        behavior: 'allow',
        reason: `Full trust worker: ${workerId}`,
        decidedBy: 'policy',
        decidedAt: new Date(),
      };
    }

    if (worker.trustLevel === 'isolated') {
      if (!worker.allowedActions.includes(action)) {
        return {
          allowed: false,
          riskLevel: 'high',
          behavior: 'deny',
          reason: `Action "${action}" not in allowed list for isolated worker`,
          decidedBy: 'policy',
          decidedAt: new Date(),
        };
      }
    }

    const isActionAllowed =
      worker.allowedActions.length === 0 ||
      worker.allowedActions.includes(action) ||
      worker.allowedActions.some((a) => action.startsWith(a));

    if (!isActionAllowed) {
      return {
        allowed: false,
        riskLevel: 'high',
        behavior: 'deny',
        reason: `Worker ${workerId} not authorized for action: ${action}`,
        decidedBy: 'policy',
        decidedAt: new Date(),
      };
    }

    const permissions = this.delegatedPermissions.get(workerId)!;
    permissions.add(action);

    globalAuditLogger.log('permission_granted', context, {
      allowed: true,
      riskLevel: context.action.estimatedRisk ?? 'medium',
      behavior: 'allow',
      reason: `Delegated to worker ${workerId}`,
      decidedBy: 'policy',
      decidedAt: new Date(),
    });

    return {
      allowed: true,
      riskLevel: context.action.estimatedRisk ?? 'medium',
      behavior: 'allow',
      reason: `Delegated to worker ${workerId}`,
      decidedBy: 'swarm',
      decidedAt: new Date(),
    };
  }

  revokeDelegation(workerId: string, action?: string): void {
    const permissions = this.delegatedPermissions.get(workerId);
    if (!permissions) {
      return;
    }

    if (action) {
      permissions.delete(action);
      logger.debug(`[SwarmWorkerHandler] Revoked: ${workerId} -> ${action}`);
    } else {
      permissions.clear();
      logger.debug(
        `[SwarmWorkerHandler] All permissions revoked for: ${workerId}`
      );
    }
  }

  getWorker(workerId: string): SwarmWorkerIdentity | undefined {
    return this.workers.get(workerId);
  }

  getActiveWorkers(): SwarmWorkerIdentity[] {
    return Array.from(this.workers.values());
  }

  getDelegatedPermissions(workerId: string): string[] {
    return Array.from(this.delegatedPermissions.get(workerId) ?? []);
  }

  createSandboxContext(
    parentContext: PermissionContext,
    workerId: string
  ): SwarmPermissionContext {
    const worker = this.workers.get(workerId);

    return {
      worker: worker ?? {
        workerId,
        workerType: 'sandbox',
        trustLevel: 'restricted',
        allowedActions: [],
      },
      inheritedRoles: parentContext.user.roles,
      isolationLevel:
        worker?.trustLevel === 'isolated' ? 'full_isolation' : 'sandbox',
    };
  }

  cleanup(): void {
    this.workers.clear();
    this.delegatedPermissions.clear();
    logger.info('[SwarmWorkerHandler] All workers cleaned up');
  }
}
