/**
 * BlueBubbles 通道配置模式
 */

export interface BlueBubblesConfig {
  enabled: boolean;
  serverUrl: string;
  password: string;
  homeHandle?: string;
  allowPrivateNetwork?: boolean;
}

export function getDefaultBlueBubblesConfig(): BlueBubblesConfig {
  return {
    enabled: false,
    serverUrl: 'http://localhost:1234',
    password: '',
    homeHandle: '',
    allowPrivateNetwork: false,
  };
}

export function validateBlueBubblesConfig(
  config: Record<string, unknown>
): string[] {
  const errors: string[] = [];

  if (!config.serverUrl || typeof config.serverUrl !== 'string') {
    errors.push('serverUrl 是必填项');
  }
  if (!config.password || typeof config.password !== 'string') {
    errors.push('password 是必填项');
  }

  return errors;
}
