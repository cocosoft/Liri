/**
 * ScheduleIdentity 调度身份管理器
 * 对标 OpenClaw chronos/identity/，管理定时任务的执行身份
 */
import crypto from 'node:crypto';

/**
 * 身份类型
 */
export type IdentityType = 'system' | 'user' | 'agent' | 'service';

/**
 * 调度身份
 */
export interface ScheduleIdentity {
  id: string;
  name: string;
  type: IdentityType;
  token: string;
  permissions: string[];
  createdAt: number;
  lastUsedAt: number;
  expiresAt?: number;
  metadata: Record<string, unknown>;
}

/**
 * 身份验证结果
 */
export interface IdentityVerification {
  valid: boolean;
  identity?: ScheduleIdentity;
  error?: string;
}

/**
 * 调度身份管理器
 */
export class ScheduleIdentityManager {
  private identities: Map<string, ScheduleIdentity> = new Map();
  private tokenIndex: Map<string, string> = new Map();

  /**
   * 创建身份
   */
  create(name: string, type: IdentityType, permissions: string[] = [], expiresInMs?: number): ScheduleIdentity {
    const id = `sid_${crypto.randomUUID().slice(0, 8)}`;
    const token = `st_${crypto.randomBytes(24).toString('hex')}`;

    const identity: ScheduleIdentity = {
      id,
      name,
      type,
      token,
      permissions,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      expiresAt: expiresInMs ? Date.now() + expiresInMs : undefined,
      metadata: {},
    };

    this.identities.set(id, identity);
    this.tokenIndex.set(token, id);

    return identity;
  }

  /**
   * 获取身份
   */
  get(id: string): ScheduleIdentity | undefined {
    const identity = this.identities.get(id);

    if (!identity) {
      return undefined;
    }

    if (identity.expiresAt && Date.now() > identity.expiresAt) {
      this.identities.delete(id);
      this.tokenIndex.delete(identity.token);

      return undefined;
    }

    return identity;
  }

  /**
   * 通过 Token 验证身份
   */
  verify(token: string): IdentityVerification {
    const id = this.tokenIndex.get(token);

    if (!id) {
      return { valid: false, error: '无效的 Token' };
    }

    const identity = this.get(id);

    if (!identity) {
      return { valid: false, error: '身份已过期' };
    }

    identity.lastUsedAt = Date.now();

    return { valid: true, identity };
  }

  /**
   * 检查权限
   */
  hasPermission(id: string, permission: string): boolean {
    const identity = this.get(id);

    if (!identity) {
      return false;
    }

    if (identity.permissions.includes('*') || identity.permissions.includes('all')) {
      return true;
    }

    return identity.permissions.includes(permission);
  }

  /**
   * 更新身份
   */
  update(id: string, updates: Partial<Pick<ScheduleIdentity, 'name' | 'permissions' | 'metadata'>>): boolean {
    const identity = this.identities.get(id);

    if (!identity) {
      return false;
    }

    if (updates.name !== undefined) {
      identity.name = updates.name;
    }

    if (updates.permissions !== undefined) {
      identity.permissions = updates.permissions;
    }

    if (updates.metadata !== undefined) {
      identity.metadata = { ...identity.metadata, ...updates.metadata };
    }

    return true;
  }

  /**
   * 删除身份
   */
  delete(id: string): boolean {
    const identity = this.identities.get(id);

    if (!identity) {
      return false;
    }

    this.tokenIndex.delete(identity.token);

    return this.identities.delete(id);
  }

  /**
   * 刷新 Token
   */
  refreshToken(id: string): string | undefined {
    const identity = this.identities.get(id);

    if (!identity) {
      return undefined;
    }

    this.tokenIndex.delete(identity.token);

    const newToken = `st_${crypto.randomBytes(24).toString('hex')}`;

    identity.token = newToken;
    this.tokenIndex.set(newToken, id);

    return newToken;
  }

  /**
   * 获取所有身份
   */
  getAll(): ScheduleIdentity[] {
    this.cleanExpired();

    return Array.from(this.identities.values());
  }

  /**
   * 按类型获取身份
   */
  getByType(type: IdentityType): ScheduleIdentity[] {
    return this.getAll().filter((i) => i.type === type);
  }

  /**
   * 清理过期身份
   */
  cleanExpired(): number {
    const now = Date.now();
    let count = 0;

    for (const [id, identity] of this.identities.entries()) {
      if (identity.expiresAt && now > identity.expiresAt) {
        this.tokenIndex.delete(identity.token);
        this.identities.delete(id);
        count++;
      }
    }

    return count;
  }

  /**
   * 获取统计信息
   */
  getStats(): { total: number; byType: Record<string, number> } {
    this.cleanExpired();

    const byType: Record<string, number> = {};

    for (const identity of this.identities.values()) {
      byType[identity.type] = (byType[identity.type] || 0) + 1;
    }

    return {
      total: this.identities.size,
      byType,
    };
  }
}

export const scheduleIdentityManager = new ScheduleIdentityManager();
