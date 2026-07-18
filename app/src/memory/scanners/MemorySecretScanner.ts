/**
 * 记忆秘密扫描器
 * 在保存或同步记忆前扫描敏感信息
 * 参考CC源码 cc_code/backend/services/teamMemorySync/secretScanner.ts 实现
 */

import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = new Logger({
  module: 'memory:secretScanner',
  level: LogLevel.INFO,
});

/**
 * 秘密规则
 */
interface SecretRule {
  id: string;
  source: string;
  flags?: string;
}

/**
 * 秘密匹配结果
 */
export interface SecretMatch {
  ruleId: string;
  label: string;
}

/**
 * 秘密扫描结果
 */
export interface SecretScanResult {
  hasSecrets: boolean;
  matches: SecretMatch[];
  sanitized?: string;
}

/**
 * 秘密规则列表
 */
const SECRET_RULES: SecretRule[] = [
  // 云服务商
  {
    id: 'aws-access-token',
    source: '\\b((?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16})\\b',
  },
  {
    id: 'gcp-api-key',
    source: '\\b(AIza[\\w-]{35})(?:[\\x60\'"\\s;]|\\\\[nr]|$)',
  },
  {
    id: 'azure-ad-client-secret',
    source:
      '(?:^|[\\\\\'"\\x60\\s>=:(,)])([a-zA-Z0-9_~.]{3}\\dQ~[a-zA-Z0-9_~.-]{31,34})(?:$|[\\\\\'"\\x60\\s<),])',
  },
  {
    id: 'digitalocean-pat',
    source: '\\b(dop_v1_[a-f0-9]{64})(?:[\\x60\'"\\s;]|\\\\[nr]|$)',
  },

  // AI API
  {
    id: 'openai-api-key',
    source:
      '\\b(sk-[a-zA-Z0-9]{20}T3BlbkFJ[a-zA-Z0-9]{20})(?:[\\x60\'"\\s;]|\\\\[nr]|$)',
  },

  // GitHub
  {
    id: 'github-pat',
    source: 'ghp_[0-9a-zA-Z]{36}',
  },
  {
    id: 'github-fine-grained-pat',
    source: 'github_pat_\\w{82}',
  },
  {
    id: 'github-oauth',
    source: 'gho_[0-9a-zA-Z]{36}',
  },

  // SSH
  {
    id: 'ssh-private-key',
    source: '-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----',
  },
  {
    id: 'ssh-password',
    source: 'sshpass(?:\\s+-[pP])?\\s+[\'"]?\\S+[\'"]?',
  },

  // 数据库
  {
    id: 'database-url',
    source: '(?:mongodb|jdbc:mysql|postgresql|redis|memcached)://[^\\s\'"]+',
  },

  // 通用
  {
    id: 'generic-api-key',
    source:
      '\\b(?:api[_-]?key|apikey|api_secret|secret[_-]?key)["\']?\\s*[:=]\\s*["\']?[a-zA-Z0-9_\\-]{20,}["\']?',
  },
  {
    id: 'generic-secret',
    source:
      '\\b(?:password|passwd|pwd|secret)["\']?\\s*[:=]\\s*["\']?[^\\s\'"]{8,}["\']?',
  },
  {
    id: 'bearer-token',
    source: '(?:Bearer|Basic)\\s+[a-zA-Z0-9_\\-]+',
  },
  {
    id: 'jwt-token',
    source: 'eyJ[a-zA-Z0-9_-]*\\.eyJ[a-zA-Z0-9_-]*\\.[a-zA-Z0-9_-]*',
  },

  // Slack
  {
    id: 'slack-token',
    source: 'xox[baprs]-[0-9a-zA-Z-]{10,}',
  },

  // Stripe
  {
    id: 'stripe-api-key',
    source: 'sk_live_[0-9a-zA-Z]{24}',
  },
  {
    id: 'stripe-publishable-key',
    source: 'pk_live_[0-9a-zA-Z]{24}',
  },

  // Twilio
  {
    id: 'twilio-api-key',
    source: 'SK[0-9a-fA-F]{32}',
  },

  // SendGrid
  {
    id: 'sendgrid-api-key',
    source: 'SG\\.[a-zA-Z0-9_-]{22}\\.[a-zA-Z0-9_-]{43}',
  },

  // NPM
  {
    id: 'npm-token',
    source: 'npm_[a-zA-Z0-9]{36}',
  },
];

/**
 * 规则ID转标签的映射
 */
const RULE_LABELS: Record<string, string> = {
  'aws-access-token': 'AWS Access Token',
  'gcp-api-key': 'GCP API Key',
  'azure-ad-client-secret': 'Azure AD Client Secret',
  'digitalocean-pat': 'DigitalOcean PAT',
  'openai-api-key': 'OpenAI API Key',
  'github-pat': 'GitHub PAT',
  'github-fine-grained-pat': 'GitHub Fine-grained PAT',
  'github-oauth': 'GitHub OAuth',
  'ssh-private-key': 'SSH Private Key',
  'ssh-password': 'SSH Password',
  'database-url': 'Database URL',
  'generic-api-key': 'Generic API Key',
  'generic-secret': 'Generic Secret',
  'bearer-token': 'Bearer Token',
  'jwt-token': 'JWT Token',
  'slack-token': 'Slack Token',
  'stripe-api-key': 'Stripe API Key',
  'stripe-publishable-key': 'Stripe Publishable Key',
  'twilio-api-key': 'Twilio API Key',
  'sendgrid-api-key': 'SendGrid API Key',
  'npm-token': 'NPM Token',
};

/**
 * 编译后的规则缓存
 */
const compiledRules: Map<string, RegExp> = new Map();

/**
 * 编译规则
 */
function compileRule(rule: SecretRule): RegExp {
  const cached = compiledRules.get(rule.id);
  if (cached) return cached;

  try {
    const regex = new RegExp(rule.source, rule.flags || 'gi');
    compiledRules.set(rule.id, regex);
    return regex;
  } catch (error) {
    void handleError(error, {
      module: 'memory:secret',
      action: 'compile_rule',
      context: { ruleId: rule.id },
    });
    return /\b(?!)\b/; // 空规则
  }
}

/**
 * 获取规则标签
 */
function getRuleLabel(ruleId: string): string {
  return RULE_LABELS[ruleId] || ruleId.replace(/-/g, ' ');
}

/**
 * 扫描内容中的秘密
 */
export function scanForSecrets(content: string): SecretMatch[] {
  const matches: SecretMatch[] = [];
  const foundRules = new Set<string>();

  for (const rule of SECRET_RULES) {
    // 跳过重复匹配
    if (foundRules.has(rule.id)) continue;

    try {
      const regex = compileRule(rule);
      const results = content.match(regex);

      if (results && results.length > 0) {
        matches.push({
          ruleId: rule.id,
          label: getRuleLabel(rule.id),
        });
        foundRules.add(rule.id);
      }
    } catch (err) {
      // 忽略正则错误
    }
  }

  return matches;
}

/**
 * 检查内容是否包含秘密
 */
export function containsSecrets(content: string): boolean {
  return scanForSecrets(content).length > 0;
}

/**
 * 脱敏内容
 */
export function sanitizeSecrets(
  content: string,
  placeholder: string = '[REDACTED]'
): string {
  let sanitized = content;

  for (const rule of SECRET_RULES) {
    try {
      const regex = compileRule(rule);
      sanitized = sanitized.replace(regex, (match) => {
        if (match.length <= 8) return placeholder;
        return (
          match.substring(0, 4) +
          placeholder +
          match.substring(match.length - 4)
        );
      });
    } catch (err) {
      // 忽略正则错误
    }
  }

  return sanitized;
}

/**
 * 扫描记忆内容
 */
export function scanMemoryContent(content: string): SecretScanResult {
  const matches = scanForSecrets(content);

  return {
    hasSecrets: matches.length > 0,
    matches,
  };
}

/**
 * 验证并报告秘密
 */
export function validateMemoryContent(content: string): {
  valid: boolean;
  message?: string;
} {
  const matches = scanForSecrets(content);

  if (matches.length === 0) {
    return { valid: true };
  }

  const labels = matches.map((m) => m.label).join(', ');
  return {
    valid: false,
    message: `记忆内容包含敏感信息 (${labels})，无法保存或同步。请移除敏感内容后重试。`,
  };
}

/**
 * 创建记忆秘密扫描器
 */
export class MemorySecretScanner {
  private rules: SecretRule[];
  private enabled: boolean = true;

  constructor(customRules?: SecretRule[]) {
    this.rules = customRules || SECRET_RULES;
  }

  /**
   * 扫描内容
   */
  scan(content: string): SecretScanResult {
    if (!this.enabled) {
      return { hasSecrets: false, matches: [] };
    }

    const matches: SecretMatch[] = [];
    const foundRules = new Set<string>();

    for (const rule of this.rules) {
      if (foundRules.has(rule.id)) continue;

      try {
        const regex = new RegExp(rule.source, rule.flags || 'gi');
        const results = content.match(regex);

        if (results && results.length > 0) {
          matches.push({
            ruleId: rule.id,
            label: getRuleLabel(rule.id),
          });
          foundRules.add(rule.id);
        }
      } catch (err) {
        // 忽略
      }
    }

    return {
      hasSecrets: matches.length > 0,
      matches,
    };
  }

  /**
   * 脱敏内容
   */
  sanitize(content: string, placeholder?: string): string {
    let sanitized = content;

    for (const rule of this.rules) {
      try {
        const regex = new RegExp(rule.source, rule.flags || 'gi');
        sanitized = sanitized.replace(regex, (match) => {
          if (match.length <= 8) return placeholder || '[REDACTED]';
          return (
            match.substring(0, 4) +
            (placeholder || '[REDACTED]') +
            match.substring(match.length - 4)
          );
        });
      } catch (err) {
        // 忽略
      }
    }

    return sanitized;
  }

  /**
   * 验证内容
   */
  validate(content: string): { valid: boolean; message?: string } {
    const result = this.scan(content);

    if (!result.hasSecrets) {
      return { valid: true };
    }

    const labels = result.matches.map((m) => m.label).join(', ');
    return {
      valid: false,
      message: `内容包含敏感信息 (${labels})，无法保存或同步。请移除敏感内容后重试。`,
    };
  }

  /**
   * 启用/禁用扫描器
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * 检查是否启用
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * 添加自定义规则
   */
  addRule(rule: SecretRule): void {
    this.rules.push(rule);
  }

  /**
   * 移除规则
   */
  removeRule(ruleId: string): void {
    this.rules = this.rules.filter((r) => r.id !== ruleId);
  }
}

/**
 * 导出默认实例
 */
export const defaultMemorySecretScanner = new MemorySecretScanner();
