/**
 * 上下文可见性审计模块
 * 检测 Agent 上下文中是否包含敏感信息
 * 对齐 OpenClaw security/context-visibility.ts
 */

import type { SecurityAuditFinding, AuditSeverity } from './AuditTypes';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ level: LogLevel.INFO });

const SENSITIVE_PATTERNS: Array<{
  name: string;
  pattern: RegExp;
  severity: AuditSeverity;
}> = [
  {
    name: 'API Key',
    pattern: /(?:api[_-]?key|apikey|secret[_-]?key)\s*[:=]\s*['"][^'"]+['"]/i,
    severity: 'HIGH',
  },
  {
    name: 'Password',
    pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]+['"]/i,
    severity: 'HIGH',
  },
  {
    name: 'Token',
    pattern: /(?:token|jwt|bearer)\s*[:=]\s*['"][^'"]{20,}['"]/i,
    severity: 'HIGH',
  },
  {
    name: 'Private Key',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PRIVATE )?PRIVATE KEY-----/,
    severity: 'HIGH',
  },
  {
    name: 'Database URL',
    pattern: /(?:mongodb|postgres|mysql|redis):\/\/[^:]+:[^@]+@/,
    severity: 'MEDIUM',
  },
  {
    name: 'Connection String',
    pattern:
      /(?:connection[_-]?string|connstr)\s*[:=]\s*['"]\w+:\/\/[^'"]+['"]/i,
    severity: 'MEDIUM',
  },
  {
    name: 'IP Address',
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/,
    severity: 'LOW',
  },
  {
    name: 'Email',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,
    severity: 'LOW',
  },
  {
    name: 'Phone Number',
    pattern: /\b(?:\+\d{1,3}[-.]?)?\(?\d{3}\)?[-.]?\d{3}[-.]?\d{4}\b/,
    severity: 'LOW',
  },
];

/**
 * 审计上下文可见性
 */
export function auditContextVisibility(
  messages: Array<{ role: string; content: string }> = []
): SecurityAuditFinding[] {
  const findings: SecurityAuditFinding[] = [];

  try {
    if (messages.length === 0) {
      logger.info('上下文可见性审计跳过：无消息输入');
      return findings;
    }

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      for (const { name, pattern, severity } of SENSITIVE_PATTERNS) {
        const match = pattern.exec(msg.content);
        if (match) {
          findings.push({
            id: `CTX_${name.replace(/\s+/g, '_')}_msg${i}`,
            severity,
            category: 'context_visibility',
            message: `消息 #${i} (role: ${msg.role}) 中包含疑似 ${name}: ${truncateMiddle(match[0], 30)}`,
            remediation: `将 ${name} 从上下文中移除，使用环境变量或密钥管理系统`,
          });
        }
      }
    }

    logger.info(`上下文可见性审计完成，发现 ${findings.length} 个问题`);
  } catch (error) {
    logger.error('上下文可见性审计失败', error as Error);
  }

  return findings;
}

function truncateMiddle(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  const half = Math.floor(maxLen / 2);
  return str.slice(0, half) + '...' + str.slice(str.length - half);
}
