export interface ACPPermissionRequest {
  toolName: string;
  toolArgs: Record<string, unknown>;
  userId: string;
  sessionId: string;
  risk: 'low' | 'medium' | 'high' | 'critical';
  reason?: string;
}

export enum ACPPermissionDecision {
  ALLOW = 'allow',
  DENY = 'deny',
  DEFER = 'defer',
}

export interface ACPPermissionResponse {
  decision: ACPPermissionDecision;
  reason: string;
  approvedBy?: string;
  approvedAt?: number;
  expirationMs?: number;
}

export class ACPPermissionHandler {
  private pending: Map<string, ACPPermissionRequest> = new Map();
  private approvedCache: Map<
    string,
    { decision: ACPPermissionDecision; expiresAt: number }
  > = new Map();
  private cacheTTLMs: number;

  constructor(cacheTTLMs = 300_000) {
    this.cacheTTLMs = cacheTTLMs;
  }

  requestApproval(request: ACPPermissionRequest): ACPPermissionResponse {
    const key = `${request.sessionId}:${request.toolName}`;
    const cached = this.approvedCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return { decision: cached.decision, reason: 'cached approval' };
    }

    if (request.risk === 'low') {
      this.cacheDecision(key, ACPPermissionDecision.ALLOW);
      return {
        decision: ACPPermissionDecision.ALLOW,
        reason: 'auto: low risk',
      };
    }

    this.pending.set(key, request);

    return {
      decision: ACPPermissionDecision.DEFER,
      reason: `Approval required for ${request.toolName}`,
    };
  }

  approve(key: string, approver?: string): ACPPermissionResponse {
    const cached = this.approvedCache.get(key);
    const expiresAt = Date.now() + this.cacheTTLMs;
    this.approvedCache.set(key, {
      decision: ACPPermissionDecision.ALLOW,
      expiresAt,
    });
    this.pending.delete(key);

    return {
      decision: ACPPermissionDecision.ALLOW,
      reason: `Approved${approver ? ` by ${approver}` : ''}`,
      approvedBy: approver,
      approvedAt: Date.now(),
      expirationMs: this.cacheTTLMs,
    };
  }

  deny(key: string, reason?: string): ACPPermissionResponse {
    this.pending.delete(key);

    return {
      decision: ACPPermissionDecision.DENY,
      reason: reason || 'Permission denied',
    };
  }

  getPending(): ACPPermissionRequest[] {
    return Array.from(this.pending.values());
  }

  clearCache(): void {
    this.approvedCache.clear();
  }

  private cacheDecision(key: string, decision: ACPPermissionDecision): void {
    this.approvedCache.set(key, {
      decision,
      expiresAt: Date.now() + this.cacheTTLMs,
    });
  }
}

export const acpPermissionHandler = new ACPPermissionHandler();
