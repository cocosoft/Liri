/**
 * Permission Context
 * 对标CC源码 permission/PermissionContext.ts
 * 增强权限上下文，支持细粒度的权限评估
 */

import type { RiskLevel } from '../types.js';

export interface ResourceIdentifier {
  type:
    | 'file'
    | 'directory'
    | 'command'
    | 'network'
    | 'environment'
    | 'process'
    | 'registry'
    | 'service';
  path?: string;
  name?: string;
  url?: string;
  host?: string;
  port?: number;
}

export interface UserIdentity {
  userId?: string;
  username?: string;
  roles: string[];
  sessionId?: string;
  clientIp?: string;
}

export interface ActionIntent {
  action: string;
  target: ResourceIdentifier;
  reason?: string;
  plannedSideEffects?: string[];
  estimatedRisk?: RiskLevel;
}

export interface EnvironmentalContext {
  workingDirectory?: string;
  environmentVariables?: Record<string, string>;
  systemPlatform?: string;
  isContainerized?: boolean;
  isInteractive?: boolean;
  currentMode?: string;
  toolCallId?: string;
  timestamp: Date;
}

export interface PermissionContext {
  id: string;
  user: UserIdentity;
  action: ActionIntent;
  environment: EnvironmentalContext;
  decision?: PermissionDecision;
  history?: DecisionRecord[];
  metadata?: Record<string, unknown>;
}

export interface PermissionDecision {
  allowed: boolean;
  riskLevel: RiskLevel;
  behavior: 'allow' | 'deny' | 'ask';
  reason: string;
  decidedBy: 'policy' | 'user' | 'admin' | 'system' | 'swarm';
  decidedAt: Date;
  constraints?: PermissionConstraint[];
  expiresAt?: Date;
}

export interface PermissionConstraint {
  type:
    | 'timeout'
    | 'scope'
    | 'resource_limit'
    | 'require_approval'
    | 'audit_only';
  value: string | number | boolean;
  description: string;
}

export interface DecisionRecord {
  decision: PermissionDecision;
  context: Partial<PermissionContext>;
  timestamp: Date;
}

export class PermissionContextBuilder {
  private context: Partial<PermissionContext> = {};

  setUser(identity: Partial<UserIdentity>): PermissionContextBuilder {
    this.context.user = {
      userId: identity.userId,
      username: identity.username,
      roles: identity.roles ?? [],
      sessionId: identity.sessionId,
      clientIp: identity.clientIp,
    };
    return this;
  }

  setAction(
    action: string,
    target: ResourceIdentifier
  ): PermissionContextBuilder {
    this.context.action = {
      action,
      target,
      estimatedRisk: 'low',
    };
    return this;
  }

  setReason(reason: string): PermissionContextBuilder {
    if (this.context.action) {
      this.context.action.reason = reason;
    }
    return this;
  }

  setRiskLevel(level: RiskLevel): PermissionContextBuilder {
    if (this.context.action) {
      this.context.action.estimatedRisk = level;
    }
    return this;
  }

  setEnvironment(env: Partial<EnvironmentalContext>): PermissionContextBuilder {
    this.context.environment = {
      workingDirectory: env.workingDirectory,
      environmentVariables: env.environmentVariables,
      systemPlatform: env.systemPlatform,
      isContainerized: env.isContainerized,
      isInteractive: env.isInteractive,
      currentMode: env.currentMode,
      toolCallId: env.toolCallId,
      timestamp: env.timestamp ?? new Date(),
    };
    return this;
  }

  setMetadata(metadata: Record<string, unknown>): PermissionContextBuilder {
    this.context.metadata = metadata;
    return this;
  }

  build(): PermissionContext {
    const id = this.context.id ?? crypto.randomUUID();
    const now = new Date();

    return {
      id,
      user: this.context.user ?? { roles: [] },
      action: this.context.action ?? {
        action: 'unknown',
        target: { type: 'file' },
        estimatedRisk: 'low',
      },
      environment: this.context.environment ?? {
        timestamp: now,
      },
      metadata: this.context.metadata,
    };
  }
}
