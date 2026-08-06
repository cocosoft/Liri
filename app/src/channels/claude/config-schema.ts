/**
 * Claude 通道配置模式定义
 * 对标 IRC config-schema.ts 模式
 */

export interface ClaudeConfig {
  enabled?: boolean;
  apiKey: string;
  apiUrl?: string;
  organizationId?: string;
  model: string;
  maxTokens: number;
}

const DEFAULTS: Partial<ClaudeConfig> = {
  model: '', // 空 = 由模型体系提供默认模型（不硬编码）
  maxTokens: 4096,
};

export function getDefaultClaudeConfig(): ClaudeConfig {
  return {
    enabled: false,
    apiKey: '',
    apiUrl: 'https://api.anthropic.com/v1',
    organizationId: '',
    model: DEFAULTS.model!,
    maxTokens: DEFAULTS.maxTokens!,
  };
}

export function validateClaudeConfig(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (!raw['apiKey'] || typeof raw['apiKey'] !== 'string') {
    errors.push('apiKey: 必须是非空字符串（Claude API Key）');
  }

  return errors;
}
