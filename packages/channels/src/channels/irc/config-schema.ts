/**
 * IRC 通道配置模式定义
 * 对标 OpenClaw extensions/irc/src/config-schema.ts
 */

export interface IrcConfig {
  server: string;
  port: number;
  nickname: string;
  username?: string;
  realname?: string;
  password?: string;
  nickservPassword?: string;
  channels: string[];
  tls: boolean;
  reconnectDelayMs?: number;
  maxReconnectAttempts?: number;
  lineMax?: number;
  msgChunkMax?: number;
}

const DEFAULTS: Partial<IrcConfig> = {
  port: 6667,
  tls: false,
  reconnectDelayMs: 5000,
  maxReconnectAttempts: 10,
  lineMax: 480,
  msgChunkMax: 350,
};

export function getDefaultIrcConfig(): IrcConfig {
  return {
    server: '',
    port: DEFAULTS.port!,
    nickname: 'Liri_bot',
    username: 'Liri_bot',
    realname: 'Liri Bot',
    password: '',
    nickservPassword: '',
    channels: [],
    tls: DEFAULTS.tls!,
    reconnectDelayMs: DEFAULTS.reconnectDelayMs,
    maxReconnectAttempts: DEFAULTS.maxReconnectAttempts,
    lineMax: DEFAULTS.lineMax,
    msgChunkMax: DEFAULTS.msgChunkMax,
  };
}

export function validateIrcConfig(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (!raw['server'] || typeof raw['server'] !== 'string') {
    errors.push('server: 必须是一个非空字符串');
  }
  if (raw['nickname'] && typeof raw['nickname'] !== 'string') {
    errors.push('nickname: 必须是一个字符串');
  }
  if (!raw['nickname']) {
    errors.push('nickname: 不能为空');
  }
  if (raw['port'] !== undefined) {
    const p = Number(raw['port']);
    if (!Number.isInteger(p) || p < 1 || p > 65535) {
      errors.push('port: 必须在 1-65535 范围内');
    }
  }
  if (raw['channels'] !== undefined) {
    if (!Array.isArray(raw['channels'])) {
      errors.push('channels: 必须是数组');
    } else if (raw['channels'].length === 0) {
      errors.push('channels: 至少需要指定一个频道');
    }
  }
  return errors;
}
