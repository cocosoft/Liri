/**
 * Matrix 通道配置模式定义
 * 对标 OpenClaw extensions/matrix/src/config-schema.ts
 */

export interface MatrixConfig {
  homeserverUrl: string;
  userId: string;
  accessToken: string;
  autoJoinRooms?: boolean;
  syncTimeoutMs?: number;
  apiBase?: string;
}

const DEFAULTS: Partial<MatrixConfig> = {
  syncTimeoutMs: 30000,
};

export function getDefaultMatrixConfig(): MatrixConfig {
  return {
    homeserverUrl: '',
    userId: '',
    accessToken: '',
    autoJoinRooms: false,
    syncTimeoutMs: DEFAULTS.syncTimeoutMs,
  };
}

export function validateMatrixConfig(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (!raw['homeserverUrl'] || typeof raw['homeserverUrl'] !== 'string') {
    errors.push('homeserverUrl: 必须是一个非空 URL 字符串');
  }
  if (!raw['userId'] || typeof raw['userId'] !== 'string') {
    errors.push('userId: 必须是一个非空字符串（格式如 @user:server）');
  }
  if (!raw['accessToken'] || typeof raw['accessToken'] !== 'string') {
    errors.push('accessToken: 必须是一个非空字符串');
  }
  if (
    raw['autoJoinRooms'] !== undefined &&
    typeof raw['autoJoinRooms'] !== 'boolean'
  ) {
    errors.push('autoJoinRooms: 必须是布尔值');
  }
  if (raw['syncTimeoutMs'] !== undefined) {
    const t = Number(raw['syncTimeoutMs']);
    if (!Number.isInteger(t) || t < 1000 || t > 120000) {
      errors.push('syncTimeoutMs: 必须在 1000-120000 范围内');
    }
  }
  return errors;
}
