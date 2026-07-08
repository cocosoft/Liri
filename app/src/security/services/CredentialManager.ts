/**
 * CredentialManager 凭据管理系统 (Crestodian)
 * P1 优先级 — 对标 OpenClaw 的凭据助手
 */
import fs from 'node:fs';
import path from 'path';
import crypto from 'node:crypto';
import { resolvePyappHome } from '@modules/core';
import { handleError } from '@modules/error';

/**
 * 凭据类型
 */
export type CredentialType =
  | 'api-key'
  | 'access-token'
  | 'refresh-token'
  | 'client-id'
  | 'client-secret'
  | 'password'
  | 'ssh-key'
  | 'certificate';

/**
 * 凭据作用域
 */
export type CredentialScope = 'global' | 'project' | 'local' | 'user';

/**
 * 凭据接口
 */
export interface Credential {
  id: string;
  name: string;
  type: CredentialType;
  scope: CredentialScope;
  value: string;
  provider?: string;
  expiresAt?: number;
  createdAt: number;
  updatedAt: number;
  tags: string[];
  metadata?: Record<string, unknown>;
}

/**
 * 加密凭据
 */
export interface EncryptedCredential {
  id: string;
  name: string;
  type: CredentialType;
  scope: CredentialScope;
  encryptedValue: string;
  iv: string;
  tag: string;
  provider?: string;
  expiresAt?: number;
  createdAt: number;
  updatedAt: number;
  tags: string[];
  metadata?: Record<string, unknown>;
}

/**
 * 凭据审计条目
 */
export interface CredentialAuditEntry {
  id: string;
  credentialId: string;
  action: 'create' | 'read' | 'update' | 'delete' | 'expire';
  timestamp: number;
  source: string;
}

/**
 * 凭据管理器
 */
export class CredentialManager {
  private storePath: string;
  private encryptionKey: Buffer;
  private credentials: Map<string, Credential> = new Map();
  private auditLog: CredentialAuditEntry[] = [];

  constructor(storePath?: string) {
    this.storePath =
      storePath || path.join(resolvePyappHome(), 'credentials', 'store.enc');
    this.encryptionKey = this.loadOrCreateKey();
    this.loadStore();
  }

  /**
   * 保存凭据
   */
  save(
    credential: Omit<Credential, 'id' | 'createdAt' | 'updatedAt'>
  ): Credential {
    const now = Date.now();
    const newCredential: Credential = {
      ...credential,
      id: this.generateId(),
      createdAt: now,
      updatedAt: now,
    };

    this.credentials.set(newCredential.id, newCredential);
    this.persistStore();
    this.audit({
      credentialId: newCredential.id,
      action: 'create',
      source: 'CredentialManager',
    });

    return newCredential;
  }

  /**
   * 读取凭据
   */
  get(id: string): Credential | undefined {
    const credential = this.credentials.get(id);

    if (credential) {
      this.audit({
        credentialId: id,
        action: 'read',
        source: 'CredentialManager',
      });
    }

    return credential;
  }

  /**
   * 按名称查找
   */
  findByName(name: string): Credential | undefined {
    return Array.from(this.credentials.values()).find((c) => c.name === name);
  }

  /**
   * 按类型查询
   */
  findByType(type: CredentialType): Credential[] {
    return Array.from(this.credentials.values()).filter((c) => c.type === type);
  }

  /**
   * 更新凭据
   */
  update(
    id: string,
    updates: Partial<Omit<Credential, 'id' | 'createdAt'>>
  ): boolean {
    const credential = this.credentials.get(id);

    if (!credential) return false;

    Object.assign(credential, updates, { updatedAt: Date.now() });
    this.persistStore();
    this.audit({
      credentialId: id,
      action: 'update',
      source: 'CredentialManager',
    });

    return true;
  }

  /**
   * 删除凭据
   */
  delete(id: string): boolean {
    const result = this.credentials.delete(id);

    if (result) {
      this.persistStore();
      this.audit({
        credentialId: id,
        action: 'delete',
        source: 'CredentialManager',
      });
    }

    return result;
  }

  /**
   * 获取所有凭据
   */
  getAll(filter?: {
    type?: CredentialType;
    scope?: CredentialScope;
  }): Credential[] {
    let all = Array.from(this.credentials.values());

    if (filter?.type) {
      all = all.filter((c) => c.type === filter.type);
    }

    if (filter?.scope) {
      all = all.filter((c) => c.scope === filter.scope);
    }

    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * 检查凭据是否过期
   */
  isExpired(id: string): boolean {
    const credential = this.credentials.get(id);

    if (!credential || !credential.expiresAt) return false;

    return Date.now() > credential.expiresAt;
  }

  /**
   * 获取统计
   */
  getStats(): {
    total: number;
    byType: Record<string, number>;
    expired: number;
  } {
    const all = this.getAll();
    const byType: Record<string, number> = {};

    for (const c of all) {
      byType[c.type] = (byType[c.type] || 0) + 1;
    }

    return {
      total: all.length,
      byType,
      expired: all.filter((c) => c.expiresAt && Date.now() > c.expiresAt)
        .length,
    };
  }

  /**
   * 获取审计日志
   */
  getAuditLog(limit?: number): CredentialAuditEntry[] {
    const sorted = [...this.auditLog].sort((a, b) => b.timestamp - a.timestamp);

    return limit ? sorted.slice(0, limit) : sorted;
  }

  /**
   * 生成唯一标识
   */
  private generateId(): string {
    return `cred_${crypto.randomBytes(16).toString('hex')}`;
  }

  /**
   * 加载或创建加密密钥
   */
  private loadOrCreateKey(): Buffer {
    const keyPath = path.join(resolvePyappHome(), 'credentials', '.key');

    try {
      if (fs.existsSync(keyPath)) {
        return fs.readFileSync(keyPath);
      }

      const key = crypto.randomBytes(32);
      fs.mkdirSync(path.dirname(keyPath), { recursive: true });
      fs.writeFileSync(keyPath, key, { mode: 0o600 });

      return key;
    } catch {
      return crypto.randomBytes(32);
    }
  }

  /**
   * 加密值
   */
  private encrypt(plaintext: string): {
    encrypted: string;
    iv: string;
    tag: string;
  } {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);

    let encrypted = cipher.update(plaintext, 'utf-8', 'hex');
    encrypted += cipher.final('hex');

    const tag = cipher.getAuthTag().toString('hex');

    return { encrypted, iv: iv.toString('hex'), tag };
  }

  /**
   * 解密值
   */
  private decrypt(encrypted: string, ivHex: string, tagHex: string): string {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey,
      Buffer.from(ivHex, 'hex')
    );

    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));

    let decrypted = decipher.update(encrypted, 'hex', 'utf-8');
    decrypted += decipher.final('utf-8');

    return decrypted;
  }

  /**
   * 持久化存储
   */
  private persistStore(): void {
    try {
      const data = JSON.stringify(Array.from(this.credentials.values()));
      const { encrypted, iv, tag } = this.encrypt(data);

      const store = JSON.stringify({
        encrypted,
        iv,
        tag,
        updatedAt: Date.now(),
      });
      fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
      fs.writeFileSync(this.storePath, store, 'utf-8');
    } catch (err) {
      void handleError(err, {
        module: 'security:services',
        action: 'catch_error',
      });
    }
  }

  /**
   * 加载存储
   */
  private loadStore(): void {
    try {
      if (!fs.existsSync(this.storePath)) return;

      const content = fs.readFileSync(this.storePath, 'utf-8');
      const store = JSON.parse(content);
      const decrypted = this.decrypt(store.encrypted, store.iv, store.tag);
      const credentials: Credential[] = JSON.parse(decrypted);

      for (const credential of credentials) {
        this.credentials.set(credential.id, credential);
      }
    } catch {
      this.credentials.clear();
    }
  }

  /**
   * 写入审计日志
   */
  private audit(entry: Omit<CredentialAuditEntry, 'id' | 'timestamp'>): void {
    this.auditLog.push({
      ...entry,
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
    });

    if (this.auditLog.length > 1000) {
      this.auditLog = this.auditLog.slice(-500);
    }
  }
}

export const credentialManager = new CredentialManager();
