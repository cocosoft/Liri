/**
 * 安全审计引擎
 * 统一编排所有审计维度，支持快速模式和深度模式
 */

import type {
  SecurityAuditFinding,
  SecurityAuditReport,
  SecurityAuditOptions,
  SecurityAuditContext,
} from './AuditTypes';
import { auditConfig } from './AuditConfig';
import { auditModelHygiene } from './AuditModelHygiene';
import { auditPlugins } from './AuditPlugins';
import { auditFilesystem } from './AuditFilesystem';
import { auditContextVisibility } from './ContextVisibility';
import { buildAuditReport } from './AuditReport';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { resolveProjectRoot } from '@modules/core';

const logger = new Logger({
  module: 'security:auditEngine',
  level: LogLevel.INFO,
});

const DEFAULT_DEEP_TIMEOUT_MS = 30000;

/**
 * 创建默认审计上下文
 */
export function createDefaultAuditContext(
  options: SecurityAuditOptions = {}
): SecurityAuditContext {
  return {
    config: options.config || {},
    env: (options.env as Record<string, string>) || {},
    deep: options.deep || false,
    includeFilesystem: options.includeFilesystem !== false,
    includePlugins: options.includePlugins !== false,
    stateDir: options.stateDir || resolveProjectRoot(),
    configPath: options.configPath || resolveProjectRoot(),
    workspaceDir: options.workspaceDir || resolveProjectRoot(),
    deepTimeoutMs: options.deepTimeoutMs || DEFAULT_DEEP_TIMEOUT_MS,
  };
}

/**
 * 安全审计引擎
 */
export class AuditEngine {
  private ctx: SecurityAuditContext;

  constructor(options: SecurityAuditOptions = {}) {
    this.ctx = createDefaultAuditContext(options);
  }

  /**
   * 执行完整安全审计
   */
  async audit(): Promise<SecurityAuditReport> {
    const startTime = Date.now();
    logger.info('安全审计开始...');

    const findings: SecurityAuditFinding[] = [];

    try {
      // 配置审计（始终执行）
      const configFindings = auditConfig(this.ctx.config);
      findings.push(...configFindings);

      // 模型卫生审计（始终执行）
      const modelFindings = auditModelHygiene(this.ctx.workspaceDir);
      findings.push(...modelFindings);

      // 插件审计（可选）
      if (this.ctx.includePlugins) {
        const pluginFindings = auditPlugins();
        findings.push(...pluginFindings);
      }

      // 文件系统审计（可选）
      if (this.ctx.includeFilesystem) {
        const fsFindings = auditFilesystem(this.ctx.workspaceDir);
        findings.push(...fsFindings);
      }

      // 上下文可见性审计（始终执行）
      const ctxFindings = auditContextVisibility();
      findings.push(...ctxFindings);

      // 深度审计（可选）
      let deepFindings:
        | {
            codeSafetyFindings?: SecurityAuditFinding[];
            probeFindings?: SecurityAuditFinding[];
            sandboxFindings?: SecurityAuditFinding[];
          }
        | undefined;

      if (this.ctx.deep) {
        deepFindings = await this.performDeepAudit();
        const deepTotal = [
          ...(deepFindings.codeSafetyFindings || []),
          ...(deepFindings.probeFindings || []),
          ...(deepFindings.sandboxFindings || []),
        ];
        findings.push(...deepTotal);
      }

      const report = buildAuditReport(findings, startTime, deepFindings);
      logger.info(`安全审计完成: ${report.summary.total} 个发现`);
      return report;
    } catch (error) {
      void handleError(error, {
        module: 'security:audit:engine',
        action: '安全审计执行失败',
      });
      const report = buildAuditReport(findings, startTime);
      return report;
    }
  }

  /**
   * 执行深度审计
   */
  private async performDeepAudit(): Promise<{
    codeSafetyFindings: SecurityAuditFinding[];
    probeFindings: SecurityAuditFinding[];
    sandboxFindings: SecurityAuditFinding[];
  }> {
    logger.info('深度审计开始...');
    const findings: {
      codeSafetyFindings: SecurityAuditFinding[];
      probeFindings: SecurityAuditFinding[];
      sandboxFindings: SecurityAuditFinding[];
    } = {
      codeSafetyFindings: [],
      probeFindings: [],
      sandboxFindings: [],
    };

    // 深度代码安全检测
    findings.codeSafetyFindings = this.auditDeepCodeSafety();

    // 沙箱安全检测（深度）
    if (this.ctx.includeFilesystem) {
      findings.sandboxFindings = this.auditDeepSandbox();
    }

    logger.info(
      `深度审计完成: codeSafety=${findings.codeSafetyFindings.length} sandbox=${findings.sandboxFindings.length}`
    );
    return findings;
  }

  private auditDeepCodeSafety(): SecurityAuditFinding[] {
    const findings: SecurityAuditFinding[] = [];

    // 检查是否存在 eval/Function 等动态代码执行
    // 这是深度审计的基础实现，可后续扩展
    const dangerousPatterns = [
      {
        id: 'DEEP_code-eval',
        pattern: /\beval\s*\(/,
        severity: 'HIGH' as const,
        message: '代码中使用了 eval() 动态执行',
        remediation: '避免使用 eval()，改用更安全的替代方案',
      },
      {
        id: 'DEEP_code-newfunc',
        pattern: /new\s+Function\s*\(/,
        severity: 'HIGH' as const,
        message: '代码中使用了 new Function() 动态执行',
        remediation: '避免使用 new Function()，改用更安全的替代方案',
      },
      {
        id: 'DEEP_code-exec',
        pattern: /child_process\.exec\s*\(/,
        severity: 'MEDIUM' as const,
        message: '代码中使用了 child_process.exec()',
        remediation:
          '优先使用 child_process.spawn() 替代 exec()，避免 shell 注入',
      },
    ];

    try {
      const { readFileSync, readdirSync } = require('fs');
      const { join } = require('path');
      const srcDir = join(this.ctx.workspaceDir, 'src');

      if (existsSync(srcDir)) {
        const tsFiles = this.findTsFiles(srcDir);
        for (const file of tsFiles) {
          try {
            const content = readFileSync(file, 'utf-8');
            for (const {
              id,
              pattern,
              severity,
              message,
              remediation,
            } of dangerousPatterns) {
              if (pattern.test(content)) {
                findings.push({
                  id: `${id}_${file.replace(/[/.]/g, '_')}`,
                  severity,
                  category: 'general',
                  path: file,
                  message: `${message}: ${file}`,
                  remediation,
                });
              }
            }
          } catch (err) {
            // 文件读取失败
          }
        }
      }
    } catch (error) {
      void handleError(error, {
        module: 'security:audit:engine',
        action: '深度代码安全检测失败',
      });
    }

    return findings;
  }

  private auditDeepSandbox(): SecurityAuditFinding[] {
    const findings: SecurityAuditFinding[] = [];

    // 检查 Dockerfile 和 docker-compose 安全性
    try {
      const { existsSync, readFileSync } = require('fs');
      const { join } = require('path');
      const dockerfile = join(this.ctx.workspaceDir, 'Dockerfile');

      if (existsSync(dockerfile)) {
        try {
          const content = readFileSync(dockerfile, 'utf-8');
          if (/^USER\s+root$/m.test(content)) {
            findings.push({
              id: 'DEEP_docker-root',
              severity: 'MEDIUM',
              category: 'sandbox',
              path: dockerfile,
              message: 'Dockerfile 以 root 用户运行',
              remediation: '在 Dockerfile 末尾添加非 root 用户，如: USER node',
            });
          }
          if (/^FROM\s+(?!.*:alpine|.*:slim)/m.test(content)) {
            findings.push({
              id: 'DEEP_docker-image',
              severity: 'LOW',
              category: 'sandbox',
              path: dockerfile,
              message:
                'Dockerfile 使用完整镜像，建议使用 alpine 或 slim 变体减小攻击面',
              remediation: '将 FROM 镜像替换为 alpine 或 slim 变体',
            });
          }
        } catch (err) {
          // 读取失败
        }
      }
    } catch (err) {
      // 审计失败
    }

    return findings;
  }

  private findTsFiles(dir: string): string[] {
    const results: string[] = [];
    try {
      const { readdirSync, statSync } = require('fs');
      const { join } = require('path');
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (
          entry.isDirectory() &&
          !entry.name.startsWith('.') &&
          entry.name !== 'node_modules'
        ) {
          results.push(...this.findTsFiles(fullPath));
        } else if (
          entry.isFile() &&
          (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))
        ) {
          results.push(fullPath);
        }
      }
    } catch (err) {
      // readdir 失败
    }
    return results;
  }
}

function existsSync(p: string): boolean {
  try {
    const { existsSync: fsExists } = require('fs');
    return fsExists(p);
  } catch (err) {
    return false;
  }
}

/**
 * 快捷审计函数
 */
export async function runSecurityAudit(
  options: SecurityAuditOptions = {}
): Promise<SecurityAuditReport> {
  const engine = new AuditEngine(options);
  return engine.audit();
}
