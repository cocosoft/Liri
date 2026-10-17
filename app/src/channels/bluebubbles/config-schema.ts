/**
 * BlueBubbles 通道配置模式
 */

import { DEFAULT_BLUEBUBBLES_SERVER_URL } from '@modules/core';

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
    serverUrl: DEFAULT_BLUEBUBBLES_SERVER_URL,
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
