/**
 * Signal 通道配置模式定义
 * 对标 IRC config-schema.ts 模式
 */

export interface SignalConfig {
  enabled?: boolean;
  account?: string;
  phoneNumber: string;
  signalCliPath?: string;
  signalServiceUrl: string;
  registrationLockPin?: string;
}

const DEFAULTS: Partial<SignalConfig> = {
  signalServiceUrl: 'https://chat.signal.org',
};

export function getDefaultSignalConfig(): SignalConfig {
  return {
    enabled: false,
    account: '',
    phoneNumber: '',
    signalCliPath: 'signal-cli',
    signalServiceUrl: DEFAULTS.signalServiceUrl!,
  };
}

export function validateSignalConfig(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (!raw['phoneNumber'] || typeof raw['phoneNumber'] !== 'string') {
    errors.push('phoneNumber: 必须是非空字符串（Signal 手机号码）');
  }

  return errors;
}
