/**
 * 企业微信通道配置模式定义
 * 对标 IRC config-schema.ts 模式
 */

export interface WeComConfig {
  corpId: string;
  agentId: string;
  corpSecret: string;
  token: string;
  encodingAESKey?: string;
}

const DEFAULTS: Partial<WeComConfig> = {};

export function getDefaultWeComConfig(): WeComConfig {
  return {
    corpId: '',
    agentId: '',
    corpSecret: '',
    token: '',
    encodingAESKey: '',
  };
}

export function validateWeComConfig(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (!raw['corpId'] || typeof raw['corpId'] !== 'string') {
    errors.push('corpId: 必须是非空字符串（企业微信 CorpID）');
  }
  if (!raw['agentId'] || typeof raw['agentId'] !== 'string') {
    errors.push('agentId: 必须是非空字符串（企业微信 AgentID）');
  }
  if (!raw['corpSecret'] || typeof raw['corpSecret'] !== 'string') {
    errors.push('corpSecret: 必须是非空字符串（企业微信 CorpSecret）');
  }
  if (!raw['token'] || typeof raw['token'] !== 'string') {
    errors.push('token: 必须是非空字符串（企业微信 Token）');
  }

  return errors;
}
