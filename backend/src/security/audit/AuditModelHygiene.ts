/**
 * 模型卫生审计模块
 * 检测 API key 泄露、弱认证配置、模型权限失控
 * 对齐 OpenClaw security/audit-model-hygiene.ts
 */

import type { SecurityAuditFinding, AuditSeverity } from './AuditTypes';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const logger = new Logger({ level: LogLevel.INFO });

const API_KEY_PATTERNS: Array<{
  provider: string;
  pattern: RegExp;
  name: string;
}> = [
  {
    provider: 'anthropic',
    pattern: /sk-ant-[a-zA-Z0-9_-]{40,}/,
    name: 'Anthropic API Key',
  },
  {
    provider: 'openai',
    pattern: /sk-[a-zA-Z0-9]{32,}/,
    name: 'OpenAI API Key',
  },
  {
    provider: 'deepseek',
    pattern: /sk-[a-zA-Z0-9]{32,}/,
    name: 'DeepSeek API Key',
  },
  {
    provider: 'github',
    pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/,
    name: 'GitHub Token',
  },
  { provider: 'aws', pattern: /AKIA[0-9A-Z]{16}/, name: 'AWS Access Key' },
];

const SENSITIVE_CONFIG_FILES = [
  '.env',
  '.env.local',
  '.env.production',
  'config.json',
  'settings.json',
  'credentials.json',
];

/**
 * 审计模型卫生
 */
export function auditModelHygiene(
  workspaceDir?: string
): SecurityAuditFinding[] {
  const findings: SecurityAuditFinding[] = [];
  const scanDir = workspaceDir || process.cwd();

  try {
    auditApiKeyExposure(scanDir, findings);
    auditModelPermissions(scanDir, findings);
    auditProviderConfig(scanDir, findings);

    logger.info(`模型卫生审计完成，发现 ${findings.length} 个问题`);
  } catch (error) {
    logger.error('模型卫生审计失败', error as Error);
  }

  return findings;
}

function auditApiKeyExposure(
  scanDir: string,
  findings: SecurityAuditFinding[]
): void {
  for (const file of SENSITIVE_CONFIG_FILES) {
    const filePath = join(scanDir, file);
    if (!existsSync(filePath)) continue;

    try {
      const content = readFileSync(filePath, 'utf-8');

      // 检查是否为 .env.example 或模板文件
      if (file.endsWith('.example') || file === '.env.example') continue;

      for (const { provider, pattern, name } of API_KEY_PATTERNS) {
        if (pattern.test(content)) {
          findings.push({
            id: `MODEL_key-${provider}`,
            severity: 'HIGH',
            category: 'model_hygiene',
            path: filePath,
            message: `在 ${file} 中发现疑似 ${name} 泄露`,
            remediation: `将 ${name} 移至安全的密钥管理系统或加密存储，从 ${file} 中删除明文密钥`,
          });
        }
      }
    } catch {
      // 文件读取失败
    }
  }
}

function auditModelPermissions(
  scanDir: string,
  findings: SecurityAuditFinding[]
): void {
  const configPath = join(scanDir, 'config', 'governance.json');
  if (!existsSync(configPath)) return;

  try {
    const governance = JSON.parse(readFileSync(configPath, 'utf-8'));
    if (governance['allowAllModels'] === true) {
      findings.push({
        id: 'MODEL_perm-001',
        severity: 'MEDIUM',
        category: 'model_hygiene',
        path: configPath,
        message: '模型访问策略设置了 allowAllModels，未限制可用模型范围',
        remediation: '限制可用的模型列表，仅允许经过审查的模型',
      });
    }
    if (
      governance['maxTokensPerRequest'] &&
      governance['maxTokensPerRequest'] > 500000
    ) {
      findings.push({
        id: 'MODEL_perm-002',
        severity: 'LOW',
        category: 'model_hygiene',
        path: configPath,
        message: `单次请求最大 Token 数设置为 ${governance['maxTokensPerRequest']}，可能导致高昂成本`,
        remediation: '根据使用场景设置合理的 Token 上限',
      });
    }
  } catch {
    // 配置解析失败
  }
}

function auditProviderConfig(
  scanDir: string,
  findings: SecurityAuditFinding[]
): void {
  const aiConfigFiles = [
    join(scanDir, 'src', 'ai', 'models', 'ModelConfigs.ts'),
    join(scanDir, 'config', 'ai.json'),
  ];

  for (const filePath of aiConfigFiles) {
    if (!existsSync(filePath)) continue;

    try {
      const content = readFileSync(filePath, 'utf-8');

      // 检查是否有 disabled 但仍有 API key 的 provider
      if (
        /disabled.*true/i.test(content) &&
        API_KEY_PATTERNS.some((p) => p.pattern.test(content))
      ) {
        findings.push({
          id: 'MODEL_provider-001',
          severity: 'LOW',
          category: 'model_hygiene',
          path: filePath,
          message: '已禁用的 Provider 仍配置了 API Key',
          remediation: '移除已禁用 Provider 的 API Key 配置',
        });
      }
    } catch {
      // 读取失败
    }
  }
}
