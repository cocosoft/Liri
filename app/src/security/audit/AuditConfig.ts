/**
 * 配置审计模块
 * 检查配置安全性：危险配置项、弱认证、不安全的默认值
 * 对齐 OpenClaw security/audit-gateway-config.ts + dangerous-config-flags.ts
 */

import type { SecurityAuditFinding, AuditSeverity } from './AuditTypes';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ level: LogLevel.INFO });

const DANGEROUS_CONFIG_PATTERNS = [
  {
    id: 'dc-001',
    pattern: /\brm\s+-rf\s+\/\b/,
    severity: 'HIGH' as AuditSeverity,
    message: '配置中包含 rm -rf / 命令引用',
    remediation: '移除对根目录的递归删除模式，使用更安全的路径限制',
  },
  {
    id: 'dc-002',
    pattern: /\bchmod\s+777\b/,
    severity: 'HIGH' as AuditSeverity,
    message: '配置或脚本中包含 chmod 777 权限',
    remediation: '使用更严格的文件权限（如 644 或 755），避免完全开放权限',
  },
  {
    id: 'dc-003',
    pattern: /\beval\s+/,
    severity: 'MEDIUM' as AuditSeverity,
    message: '配置中包含 eval 命令使用',
    remediation: '避免使用 eval，改用更安全的命令执行方式',
  },
  {
    id: 'dc-004',
    pattern: /\bcurl\s+.*\|\s*(ba)?sh\b/,
    severity: 'HIGH' as AuditSeverity,
    message: '配置或脚本中包含 curl-pipe-shell 模式',
    remediation: '分两步执行：先下载到文件并校验哈希，再执行',
  },
  {
    id: 'dc-005',
    pattern: /\bpassword\s*[:=]\s*["'][^"'\s]{1,10}["']/,
    severity: 'HIGH' as AuditSeverity,
    message: '配置文件中可能包含弱密码（少于10字符）',
    remediation: '将密码移至环境变量，并使用足够强度的密码',
  },
  {
    id: 'dc-006',
    pattern: /"allowAll"\s*:\s*true/,
    severity: 'HIGH' as AuditSeverity,
    message: '权限配置中 allowAll 开关已启用',
    remediation: '关闭 allowAll，使用显式的白名单策略',
  },
  {
    id: 'dc-007',
    pattern: /"bypassPermission"\s*:\s*true/,
    severity: 'HIGH' as AuditSeverity,
    message: '跳过权限检查的配置已启用',
    remediation: '关闭 bypassPermission，恢复完整的权限检查流程',
  },
  {
    id: 'dc-008',
    pattern: /"disableSecurity"\s*:\s*true/,
    severity: 'CRITICAL' as AuditSeverity,
    message: '安全功能已被禁用',
    remediation: '立即重新启用安全功能',
  },
];

/**
 * 审计配置安全性
 */
export function auditConfig(
  config: Record<string, unknown>
): SecurityAuditFinding[] {
  const findings: SecurityAuditFinding[] = [];

  try {
    const configStr = JSON.stringify(config, null, 2);

    for (const {
      id,
      pattern,
      severity,
      message,
      remediation,
    } of DANGEROUS_CONFIG_PATTERNS) {
      if (pattern.test(configStr)) {
        findings.push({
          id: `CONFIG_${id}`,
          severity,
          category: 'dangerous_config',
          message,
          remediation,
        });
      }
    }

    auditAuthConfig(config, findings);
    auditSandboxConfig(config, findings);
    auditLoggingConfig(config, findings);

    logger.info(`配置审计完成，发现 ${findings.length} 个问题`);
  } catch (error) {
    logger.error('配置审计失败', error as Error);
  }

  return findings;
}

function auditAuthConfig(
  config: Record<string, unknown>,
  findings: SecurityAuditFinding[]
): void {
  if (config['auth'] && typeof config['auth'] === 'object') {
    const auth = config['auth'] as Record<string, unknown>;
    if (auth['mode'] === 'none') {
      findings.push({
        id: 'CONFIG_auth-001',
        severity: 'HIGH',
        category: 'config',
        message: '认证模式设置为 "none"，所有请求无需认证',
        remediation: '启用认证模式（token/password/oauth）',
      });
    }
    if (auth['allowAnonymous'] === true) {
      findings.push({
        id: 'CONFIG_auth-002',
        severity: 'HIGH',
        category: 'config',
        message: '匿名访问已启用',
        remediation: '禁用匿名访问，要求所有用户进行认证',
      });
    }
  }
}

function auditSandboxConfig(
  config: Record<string, unknown>,
  findings: SecurityAuditFinding[]
): void {
  if (config['sandbox'] && typeof config['sandbox'] === 'object') {
    const sandbox = config['sandbox'] as Record<string, unknown>;
    if (sandbox['mode'] === 'host' && sandbox['allowHostExecution'] !== false) {
      findings.push({
        id: 'CONFIG_sandbox-001',
        severity: 'MEDIUM',
        category: 'config',
        message: '沙箱模式为主机执行模式，工具将在主机上直接运行',
        remediation: '对于多用户或公开访问场景，启用 Docker 沙箱隔离',
      });
    }
  }
}

function auditLoggingConfig(
  config: Record<string, unknown>,
  findings: SecurityAuditFinding[]
): void {
  if (config['logging'] && typeof config['logging'] === 'object') {
    const logging = config['logging'] as Record<string, unknown>;
    if (logging['redactSecrets'] === false) {
      findings.push({
        id: 'CONFIG_log-001',
        severity: 'MEDIUM',
        category: 'config',
        message: '日志密钥脱敏已禁用，敏感信息可能泄露到日志',
        remediation: '启用日志密钥脱敏',
      });
    }
  }
}
