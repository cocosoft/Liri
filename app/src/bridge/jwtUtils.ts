/**
 * Token刷新调度、验证、过期检测
 */
import { randomUUID } from 'crypto';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = getLogger('bridge:jwtutil');

export interface JWTConfig {
  secret: string;
  expiresInMs: number;
  refreshThresholdMs: number;
}

export interface TokenPayload {
  sub: string;
  sessionId: string;
  iat: number;
  exp: number;
}

const DEFAULT_EXPIRES_MS = 60 * 60 * 1000; // 1 hour
const REFRESH_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

function base64Encode(str: string): string {
  return Buffer.from(str).toString('base64url');
}

function base64Decode(str: string): string {
  return Buffer.from(str, 'base64url').toString('utf-8');
}

export function createToken(payload: TokenPayload, secret: string): string {
  const header = base64Encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64Encode(JSON.stringify(payload));
  const signature = base64Encode(
    `${header}.${body}.${secret.substring(0, 16)}`
  );
  return `${header}.${body}.${signature}`;
}

export function decodeToken(token: string): TokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(base64Decode(parts[1]));
  } catch {
    void handleError(new Error('Failed to decode JWT token'), {
      module: 'bridge:jwtutil',
      action: 'decodeToken',
    });
    return null;
  }
}

export function isTokenExpired(token: string): boolean {
  const payload = decodeToken(token);
  if (!payload) return true;
  return Date.now() > payload.exp;
}

export function shouldRefreshToken(
  token: string,
  thresholdMs: number = REFRESH_THRESHOLD_MS
): boolean {
  const payload = decodeToken(token);
  if (!payload) return true;
  return payload.exp - Date.now() < thresholdMs;
}

export class TokenRefreshScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private config: JWTConfig;

  constructor(secret: string, expiresInMs?: number) {
    this.config = {
      secret,
      expiresInMs: expiresInMs || DEFAULT_EXPIRES_MS,
      refreshThresholdMs: REFRESH_THRESHOLD_MS,
    };
  }

  createSessionToken(sessionId: string): string {
    const now = Date.now();
    return createToken(
      {
        sub: `session_${randomUUID().substring(0, 8)}`,
        sessionId,
        iat: now,
        exp: now + this.config.expiresInMs,
      },
      this.config.secret
    );
  }

  scheduleRefresh(
    token: string,
    onRefresh: (newToken: string) => void,
    intervalMs: number = 60_000
  ): void {
    this.stop();
    this.timer = setInterval(() => {
      if (shouldRefreshToken(token, this.config.refreshThresholdMs)) {
        const payload = decodeToken(token);
        if (payload) {
          const newToken = this.createSessionToken(payload.sessionId);
          onRefresh(newToken);
        }
      }
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
