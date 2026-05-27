/**
 * Coordinator Handler
 * 对标CC源码 permission/handler/coordinatorHandler.ts
 * 协调处理器，管理多层权限决策的协调与聚合
 */

import { logger } from '../../../utils/log.js';
import type {
  PermissionContext,
  PermissionDecision,
} from '../PermissionContext.js';
import { globalAuditLogger } from '../logging/PermissionAuditLogger.js';

export type DecisionSource =
  | 'policy'
  | 'interactive'
  | 'admin'
  | 'swarm'
  | 'cache';

export interface WeightedDecision {
  source: DecisionSource;
  weight: number;
  decision: PermissionDecision;
}

export interface CoordinatedDecision {
  final: PermissionDecision;
  contributors: WeightedDecision[];
  consensus: 'allow' | 'deny' | 'conflict' | 'escalated';
}

export interface CoordinatorHandlerOptions {
  requiredConsensus?: number;
  escalationTimeout?: number;
  allowOverride?: boolean;
}

export class CoordinatorHandler {
  private options: Required<CoordinatorHandlerOptions>;

  constructor(options?: CoordinatorHandlerOptions) {
    this.options = {
      requiredConsensus: options?.requiredConsensus ?? 1,
      escalationTimeout: options?.escalationTimeout ?? 15000,
      allowOverride: options?.allowOverride ?? true,
    };
  }

  async coordinate(
    context: PermissionContext,
    decisions: WeightedDecision[]
  ): Promise<CoordinatedDecision> {
    if (decisions.length === 0) {
      const defaultDecision = this.makeDefaultDecision(context);
      return {
        final: defaultDecision,
        contributors: [],
        consensus: 'deny',
      };
    }

    const sorted = [...decisions].sort((a, b) => b.weight - a.weight);
    const hasDeny = sorted.some((d) => !d.decision.allowed);
    const hasAllow = sorted.some((d) => d.decision.allowed);

    let consensus: CoordinatedDecision['consensus'];
    let final: PermissionDecision;

    if (hasAllow && !hasDeny) {
      consensus = 'allow';
      final = sorted[0].decision;
    } else if (hasDeny && !hasAllow) {
      consensus = 'deny';
      final = sorted[0].decision;
    } else {
      consensus = 'conflict';
      final = this.resolveConflict(context, sorted);
    }

    if (this.options.allowOverride) {
      const adminOverride = sorted.find(
        (d) => d.source === 'admin' || d.source === 'swarm'
      );
      if (adminOverride && consensus === 'conflict') {
        final = adminOverride.decision;
        consensus = 'escalated';
      }
    }

    const result: CoordinatedDecision = {
      final,
      contributors: sorted,
      consensus,
    };

    globalAuditLogger.log(
      final.allowed ? 'permission_granted' : 'permission_denied',
      context,
      final
    );

    logger.debug(
      `[CoordinatorHandler] Consensus: ${consensus}, final: ${final.allowed ? 'ALLOW' : 'DENY'}`
    );

    return result;
  }

  private resolveConflict(
    context: PermissionContext,
    decisions: WeightedDecision[]
  ): PermissionDecision {
    const riskLevel = context.action.estimatedRisk ?? 'medium';

    if (riskLevel === 'low') {
      const allowDecision = decisions.find((d) => d.decision.allowed);
      if (allowDecision) {
        return allowDecision.decision;
      }
    }

    if (riskLevel === 'high') {
      const denyDecision = decisions.find((d) => !d.decision.allowed);
      if (denyDecision) {
        return denyDecision.decision;
      }
    }

    return this.makeDefaultDecision(context);
  }

  private makeDefaultDecision(context: PermissionContext): PermissionDecision {
    return {
      allowed: false,
      riskLevel: context.action.estimatedRisk ?? 'medium',
      behavior: 'deny',
      reason: 'No consensus reached',
      decidedBy: 'system',
      decidedAt: new Date(),
    };
  }
}
