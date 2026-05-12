import crypto from 'node:crypto';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import type {
  GatewayAuthenticator,
  AuthResult,
  AuthCredentials,
} from './GatewayAuth';

const logger = new Logger({ level: LogLevel.INFO });

export interface DeviceAuthConfig {
  codeLength?: number;
  codeExpiryMs?: number;
  pollingIntervalMs?: number;
  maxPendingCodes?: number;
  verificationUrl?: string;
}

export interface PendingDeviceCode {
  deviceCode: string;
  userCode: string;
  status: 'pending' | 'approved' | 'expired' | 'denied';
  userId?: string;
  createdAt: number;
  expiresAt: number;
  expiresIn?: number;
  metadata?: Record<string, unknown>;
  verificationUrl?: string;
}

const DEFAULT_CODE_LENGTH = 8;
const DEFAULT_CODE_EXPIRY_MS = 300_000;
const DEFAULT_POLLING_INTERVAL_MS = 5000;
const DEFAULT_MAX_PENDING_CODES = 100;

export class DeviceAuth implements GatewayAuthenticator {
  readonly name = 'DeviceAuth';
  private config: Required<DeviceAuthConfig>;
  private pendingCodes: Map<string, PendingDeviceCode> = new Map();
  private approvedSessions: Map<
    string,
    { userId: string; deviceCode: string; approvedAt: number }
  > = new Map();

  constructor(config?: DeviceAuthConfig) {
    this.config = {
      codeLength: config?.codeLength ?? DEFAULT_CODE_LENGTH,
      codeExpiryMs: config?.codeExpiryMs ?? DEFAULT_CODE_EXPIRY_MS,
      pollingIntervalMs:
        config?.pollingIntervalMs ?? DEFAULT_POLLING_INTERVAL_MS,
      maxPendingCodes: config?.maxPendingCodes ?? DEFAULT_MAX_PENDING_CODES,
      verificationUrl: config?.verificationUrl ?? 'https://example.com/device',
    };
  }

  async authenticate(credentials: AuthCredentials): Promise<AuthResult> {
    if (!credentials.deviceCode) {
      return { authenticated: false, reason: '未提供设备码' };
    }

    const pending = this.pendingCodes.get(credentials.deviceCode);
    if (!pending) {
      return { authenticated: false, reason: '设备码无效' };
    }

    if (Date.now() > pending.expiresAt) {
      this.pendingCodes.delete(credentials.deviceCode);
      return { authenticated: false, reason: '设备码已过期' };
    }

    if (pending.status === 'denied') {
      return { authenticated: false, reason: '设备码已被拒绝' };
    }

    if (pending.status === 'pending') {
      return {
        authenticated: false,
        reason: '设备码待审批',
        metadata: {
          deviceCode: pending.deviceCode,
          pollingIntervalMs: this.config.pollingIntervalMs,
        },
      };
    }

    if (pending.status === 'approved' && pending.userId) {
      const sessionId = `${pending.userId}_dev_${Date.now()}`;
      this.approvedSessions.set(sessionId, {
        userId: pending.userId,
        deviceCode: pending.deviceCode,
        approvedAt: Date.now(),
      });
      this.pendingCodes.delete(credentials.deviceCode);

      logger.info(`DeviceAuth: 用户 ${pending.userId} 设备码认证成功`);

      return {
        authenticated: true,
        userId: pending.userId,
        sessionId,
        metadata: {
          ...pending.metadata,
          deviceAuth: true,
          deviceCode: pending.deviceCode,
        },
      };
    }

    return { authenticated: false, reason: '设备码状态异常' };
  }

  async validateSession(sessionId: string): Promise<boolean> {
    return this.approvedSessions.has(sessionId);
  }

  async revokeSession(sessionId: string): Promise<void> {
    this.approvedSessions.delete(sessionId);
    logger.info(`DeviceAuth: 设备会话已注销 — ${sessionId}`);
  }

  initiateDeviceAuth(
    userId?: string,
    metadata?: Record<string, unknown>
  ): PendingDeviceCode {
    if (this.pendingCodes.size >= this.config.maxPendingCodes) {
      this.evictExpiredCodes();
      if (this.pendingCodes.size >= this.config.maxPendingCodes) {
        throw new AppError(
          `设备码池已满 (${this.config.maxPendingCodes})`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.MEDIUM
        );
      }
    }

    const deviceCode = this.generateCode(this.config.codeLength);
    const userCode = this.formatUserCode(
      this.generateCode(this.config.codeLength)
    );
    const now = Date.now();

    const pending: PendingDeviceCode = {
      deviceCode,
      userCode,
      status: 'pending',
      userId,
      createdAt: now,
      expiresAt: now + this.config.codeExpiryMs,
      metadata,
    };

    this.pendingCodes.set(deviceCode, pending);

    logger.info(`DeviceAuth: 设备码已创建 — ${deviceCode}`);

    return {
      ...pending,
      verificationUrl: this.config.verificationUrl,
      expiresIn: this.config.codeExpiryMs,
    };
  }

  private findByUserOrDeviceCode(code: string): PendingDeviceCode | undefined {
    let pending = this.pendingCodes.get(code);
    if (pending) return pending;
    for (const [, p] of this.pendingCodes) {
      if (p.userCode === code) return p;
    }
    return undefined;
  }

  approveDeviceCode(code: string, userId: string): boolean {
    const pending = this.findByUserOrDeviceCode(code);
    if (!pending || Date.now() > pending.expiresAt) {
      return false;
    }
    if (pending.status === 'approved') {
      return false;
    }
    pending.status = 'approved';
    pending.userId = userId;
    logger.info(
      `DeviceAuth: 设备码已批准 — ${pending.deviceCode} -> 用户 ${userId}`
    );
    return true;
  }

  denyDeviceCode(code: string): boolean {
    const pending = this.findByUserOrDeviceCode(code);
    if (!pending || Date.now() > pending.expiresAt) {
      return false;
    }
    pending.status = 'denied';
    logger.info(`DeviceAuth: 设备码已拒绝 — ${pending.deviceCode}`);
    return true;
  }

  poll(deviceCode: string): { status: string; userId?: string } {
    const pending = this.pendingCodes.get(deviceCode);
    if (!pending) return { status: 'expired' };
    if (Date.now() > pending.expiresAt) {
      this.pendingCodes.delete(deviceCode);
      return { status: 'expired' };
    }
    return { status: pending.status, userId: pending.userId };
  }

  getPendingCode(
    deviceCode?: string
  ): PendingDeviceCode | PendingDeviceCode[] | undefined {
    if (deviceCode) {
      const pending = this.pendingCodes.get(deviceCode);
      if (!pending) return undefined;
      if (Date.now() > pending.expiresAt) {
        this.pendingCodes.delete(deviceCode);
        return undefined;
      }
      return { ...pending };
    }
    return Array.from(this.pendingCodes.values())
      .filter((p) => Date.now() <= p.expiresAt)
      .map((p) => ({ ...p }));
  }

  getVerificationUrl(): string {
    return this.config.verificationUrl;
  }

  getActiveSessionCount(): number {
    return this.approvedSessions.size;
  }

  cleanupExpiredCodes(): number {
    const now = Date.now();
    let count = 0;
    for (const [code, pending] of this.pendingCodes) {
      if (now > pending.expiresAt) {
        this.pendingCodes.delete(code);
        count++;
      }
    }
    if (count > 0) {
      logger.info(`DeviceAuth: 已清理 ${count} 个过期设备码`);
    }
    return count;
  }

  private evictExpiredCodes(): void {
    this.cleanupExpiredCodes();
  }

  private generateCode(length: number): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    const bytes = crypto.randomBytes(length);
    for (let i = 0; i < length; i++) {
      code += chars[bytes[i] % chars.length];
    }
    return code;
  }

  private formatUserCode(code: string): string {
    const mid = Math.floor(code.length / 2);
    return `${code.slice(0, mid)}-${code.slice(mid)}`;
  }
}
