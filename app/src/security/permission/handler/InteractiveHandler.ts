/**
 * Interactive Handler
 * 对标CC源码 permission/handler/interactiveHandler.ts
 * 交互式权限处理器，向用户发起交互式确认请求
 */

import type {
  PermissionContext,
  PermissionDecision,
} from '../PermissionContext.js';
import { globalAuditLogger } from '../logging/PermissionAuditLogger.js';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('security:permission:handler:InteractiveHandler');

export type InteractiveResponse = 'allow' | 'deny' | 'allow_once' | 'deny_once';

export interface InteractiveRequest {
  id: string;
  context: PermissionContext;
  message: string;
  options: InteractiveResponse[];
  timeout: number;
  createdAt: Date;
  resolved: boolean;
}

export interface InteractiveHandlerOptions {
  timeout?: number;
  maxPendingRequests?: number;
  allowSessionOverride?: boolean;
}

export class InteractiveHandler {
  private pendingRequests: Map<string, InteractiveRequest> = new Map();
  private sessionOverrides: Map<
    string,
    { decision: 'allow' | 'deny'; expiresAt: Date }
  > = new Map();
  private options: Required<InteractiveHandlerOptions>;

  constructor(options?: InteractiveHandlerOptions) {
    this.options = {
      timeout: options?.timeout ?? 30000,
      maxPendingRequests: options?.maxPendingRequests ?? 50,
      allowSessionOverride: options?.allowSessionOverride ?? true,
    };
  }

  async requestPermission(
    context: PermissionContext,
    customMessage?: string
  ): Promise<PermissionDecision> {
    const sessionKey = this.buildSessionKey(context);

    const override = this.checkSessionOverride(sessionKey);
    if (override) {
      logger.debug(
        `[InteractiveHandler] Session override applied: ${override.decision}`
      );
      return this.makeDecision(
        override.decision === 'allow',
        context,
        `Session override: ${override.decision}`,
        'user'
      );
    }

    const request: InteractiveRequest = {
      id: crypto.randomUUID(),
      context,
      message: customMessage ?? this.buildDefaultMessage(context),
      options: ['allow', 'deny', 'allow_once', 'deny_once'],
      timeout: this.options.timeout,
      createdAt: new Date(),
      resolved: false,
    };

    if (this.pendingRequests.size >= this.options.maxPendingRequests) {
      this.evictOldestRequest();
    }

    this.pendingRequests.set(request.id, request);

    try {
      const response = await this.waitForResponse(request);
      request.resolved = true;
      this.pendingRequests.delete(request.id);

      switch (response) {
        case 'allow':
          if (this.options.allowSessionOverride) {
            this.setSessionOverride(sessionKey, 'allow');
          }
          return this.makeDecision(true, context, 'User approved', 'user');

        case 'allow_once':
          return this.makeDecision(
            true,
            context,
            'User approved (once)',
            'user'
          );

        case 'deny':
          if (this.options.allowSessionOverride) {
            this.setSessionOverride(sessionKey, 'deny');
          }
          return this.makeDecision(false, context, 'User denied', 'user');

        case 'deny_once':
          return this.makeDecision(
            false,
            context,
            'User denied (once)',
            'user'
          );
      }
    } catch (error) {
      request.resolved = true;
      this.pendingRequests.delete(request.id);

      logger.warn(`[InteractiveHandler] Request ${request.id} timed out`);
      return this.makeDecision(false, context, 'Request timed out', 'system');
    }
  }

  resolveRequest(requestId: string, response: InteractiveResponse): boolean {
    const request = this.pendingRequests.get(requestId);
    if (!request || request.resolved) {
      return false;
    }

    request.resolved = true;
    return true;
  }

  getPendingRequests(): InteractiveRequest[] {
    return Array.from(this.pendingRequests.values());
  }

  clearSessionOverrides(): void {
    this.sessionOverrides.clear();
    logger.info('[InteractiveHandler] Session overrides cleared');
  }

  private buildSessionKey(context: PermissionContext): string {
    const userPart = context.user.userId ?? 'anonymous';
    const actionPart = `${context.action.action}:${context.action.target.type}`;
    return `${userPart}::${actionPart}`;
  }

  private checkSessionOverride(
    sessionKey: string
  ): { decision: 'allow' | 'deny'; expiresAt: Date } | null {
    const override = this.sessionOverrides.get(sessionKey);
    if (!override) {
      return null;
    }

    if (override.expiresAt < new Date()) {
      this.sessionOverrides.delete(sessionKey);
      return null;
    }

    return override;
  }

  private setSessionOverride(
    sessionKey: string,
    decision: 'allow' | 'deny'
  ): void {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    this.sessionOverrides.set(sessionKey, { decision, expiresAt });
  }

  private evictOldestRequest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Date.now();

    for (const [key, request] of this.pendingRequests) {
      if (request.createdAt.getTime() < oldestTime) {
        oldestTime = request.createdAt.getTime();
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.pendingRequests.delete(oldestKey);
    }
  }

  private async waitForResponse(
    request: InteractiveRequest
  ): Promise<InteractiveResponse> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Timeout'));
      }, this.options.timeout);

      const checkInterval = setInterval(() => {
        const current = this.pendingRequests.get(request.id);
        if (current?.resolved) {
          clearTimeout(timer);
          clearInterval(checkInterval);
        }
      }, 100);

      globalAuditLogger.log('permission_ask', request.context, {
        allowed: false,
        riskLevel: request.context.action.estimatedRisk ?? 'medium',
        behavior: 'ask',
        reason: request.message,
        decidedBy: 'user',
        decidedAt: new Date(),
      });
    });
  }

  private makeDecision(
    allowed: boolean,
    context: PermissionContext,
    reason: string,
    decidedBy: PermissionDecision['decidedBy']
  ): PermissionDecision {
    const decision: PermissionDecision = {
      allowed,
      riskLevel: context.action.estimatedRisk ?? 'medium',
      behavior: allowed ? 'allow' : 'deny',
      reason,
      decidedBy,
      decidedAt: new Date(),
    };

    globalAuditLogger.log(
      allowed ? 'permission_granted' : 'permission_denied',
      context,
      decision
    );

    return decision;
  }

  private buildDefaultMessage(context: PermissionContext): string {
    const parts: string[] = [`Action: ${context.action.action}`];

    const target = context.action.target;
    if (target.path) {
      parts.push(`Target: ${target.path}`);
    } else if (target.url) {
      parts.push(`Target: ${target.url}`);
    } else if (target.name) {
      parts.push(`Target: ${target.name}`);
    }

    if (context.action.reason) {
      parts.push(`Reason: ${context.action.reason}`);
    }

    parts.push(`Risk: ${context.action.estimatedRisk ?? 'unknown'}`);

    return parts.join('\n');
  }
}
