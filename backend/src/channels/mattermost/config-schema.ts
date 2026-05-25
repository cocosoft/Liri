/**
 * Mattermost 通道配置模式
 */

export interface MattermostConfig {
  enabled: boolean;
  serverUrl: string;
  botToken: string;
  botUsername?: string;
  homeChannel?: string;
  allowedUsers?: string[];
  replyMode?: 'thread' | 'off';
  insecure?: boolean;
}

export function getDefaultMattermostConfig(): MattermostConfig {
  return {
    enabled: false,
    serverUrl: '',
    botToken: '',
    botUsername: '',
    homeChannel: '',
    allowedUsers: [],
    replyMode: 'off',
    insecure: false,
  };
}

export function validateMattermostConfig(config: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (!config.serverUrl || typeof config.serverUrl !== 'string') {
    errors.push('serverUrl 是必填项');
  }
  if (!config.botToken || typeof config.botToken !== 'string') {
    errors.push('botToken 是必填项');
  }
  if (config.replyMode && !['thread', 'off'].includes(config.replyMode as string)) {
    errors.push('replyMode 只能是 thread 或 off');
  }

  return errors;
}
