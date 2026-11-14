/**
 * 邮件通道配置模式定义
 * 对标 OpenClaw extensions/email/* 配置模式
 *
 * 使用 Node.js 内置 net/tls 模块实现 SMTP 发送，无需第三方库。
 */

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromAddress: string;
  fromName: string;
  maxRetries: number;
  timeout: number;
}

const DEFAULTS: Partial<EmailConfig> = {
  port: 587,
  secure: false,
  fromName: 'Liri',
  maxRetries: 3,
  timeout: 30000,
};

export function getDefaultEmailConfig(): EmailConfig {
  return {
    host: '',
    port: DEFAULTS.port!,
    secure: DEFAULTS.secure!,
    user: '',
    pass: '',
    fromAddress: '',
    fromName: DEFAULTS.fromName!,
    maxRetries: DEFAULTS.maxRetries!,
    timeout: DEFAULTS.timeout!,
  };
}

export function validateEmailConfig(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (!raw['host'] || typeof raw['host'] !== 'string') {
    errors.push('host: 必须是一个非空字符串（SMTP 服务器地址）');
  }
  if (!raw['user'] || typeof raw['user'] !== 'string') {
    errors.push('user: 必须是一个非空字符串（SMTP 用户名）');
  }
  if (!raw['pass'] || typeof raw['pass'] !== 'string') {
    errors.push('pass: 必须是一个非空字符串（SMTP 密码）');
  }
  if (!raw['fromAddress'] || typeof raw['fromAddress'] !== 'string') {
    errors.push('fromAddress: 必须是一个非空字符串（发件人邮箱地址）');
  }
  if (raw['fromAddress'] && typeof raw['fromAddress'] === 'string') {
    if (!raw['fromAddress'].includes('@')) {
      errors.push('fromAddress: 必须是一个有效的邮箱地址（包含 @）');
    }
  }
  if (raw['port'] !== undefined) {
    const p = Number(raw['port']);
    if (!Number.isInteger(p) || p < 1 || p > 65535) {
      errors.push('port: 必须在 1-65535 范围内');
    }
  }
  if (raw['maxRetries'] !== undefined) {
    const r = Number(raw['maxRetries']);
    if (!Number.isInteger(r) || r < 0 || r > 10) {
      errors.push('maxRetries: 必须在 0-10 范围内');
    }
  }
  if (raw['timeout'] !== undefined) {
    const t = Number(raw['timeout']);
    if (!Number.isInteger(t) || t < 1000 || t > 120000) {
      errors.push('timeout: 必须在 1000-120000 毫秒范围内');
    }
  }

  return errors;
}
