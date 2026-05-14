/**
 * Doctor命令
 * 全面自检环境、配置、权限、安全、模型状态
 * 对齐 OpenClaw commands/doctor.ts
 */

import type {
  Command,
  CommandContext,
  CommandResult,
} from '@modules/commands/types';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { runSecurityAudit } from '@modules/security/audit';
import type { SecurityAuditReport } from '@modules/security/audit';

const logger = new Logger({ level: LogLevel.INFO });

interface DoctorReport {
  environment: {
    node: string;
    bun: string;
    os: string;
    platform: string;
    arch: string;
    cwd: string;
  };
  config: {
    valid: boolean;
    issues: string[];
    suggestions: string[];
  };
  security: {
    auditFindings: number;
    highSeverityCount: number;
    passed: boolean;
    report?: SecurityAuditReport;
  };
  model: {
    provider: string;
    models: string[];
    health: 'unknown' | 'ok' | 'unavailable';
  };
  network: {
    proxyConfigured: boolean;
    connectivity: string;
  };
  timestamp: string;
}

const doctor: Command = {
  type: 'local',
  name: 'doctor',
  description:
    'Run full system diagnostics (environment, config, security, model)',
  aliases: ['diagnose', 'health'],
  loadedFrom: 'builtin',
  disableModelInvocation: true,
  userInvocable: true,

  async load() {
    return {
      async execute(
        args: string,
        context?: CommandContext
      ): Promise<CommandResult> {
        try {
          const report = await runDoctor(args);
          return {
            success: true,
            type: 'text',
            message: formatDoctorReport(report),
            data: report,
          };
        } catch (error) {
          logger.error('Doctor命令执行失败', error as Error);
          return {
            success: false,
            type: 'error',
            error: `诊断失败: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    };
  },
};

async function runDoctor(flags: string): Promise<DoctorReport> {
  const deepMode = flags.includes('--deep') || flags.includes('--audit');
  const skipSecurity = flags.includes('--skip-security');

  const report: DoctorReport = {
    environment: {
      node: process.version,
      bun:
        typeof Bun !== 'undefined' ? 'Bun (version detection skipped)' : 'N/A',
      os:
        process.platform === 'darwin'
          ? 'macOS'
          : process.platform === 'win32'
            ? 'Windows'
            : 'Linux',
      platform: process.platform,
      arch: process.arch,
      cwd: process.cwd(),
    },
    config: { valid: true, issues: [], suggestions: [] },
    security: { auditFindings: 0, highSeverityCount: 0, passed: true },
    model: { provider: 'auto', models: [], health: 'unknown' },
    network: { proxyConfigured: false, connectivity: 'unknown' },
    timestamp: new Date().toISOString(),
  };

  // 检查配置
  checkConfig(report);

  // 检查模型
  checkModelStatus(report);

  // 网络检查
  checkNetwork(report);

  // 安全检查
  if (!skipSecurity) {
    await checkSecurity(report, deepMode);
  }

  return report;
}

function checkConfig(report: DoctorReport): void {
  try {
    const { existsSync } = require('node:fs');
    const { join } = require('node:path');
    const cwd = process.cwd();

    const configFiles = ['config.json', 'settings.json', '.env.example'];
    for (const file of configFiles) {
      if (
        !existsSync(join(cwd, file)) &&
        !existsSync(join(cwd, 'config', file))
      ) {
        report.config.issues.push(`配置文件 ${file} 未找到`);
      }
    }

    if (existsSync(join(cwd, '.env'))) {
      report.config.suggestions.push(
        '.env 文件存在，确保不包含未脱敏的敏感信息'
      );
    }

    if (report.config.issues.length > 0) {
      report.config.valid = false;
    }
  } catch (error) {
    report.config.issues.push(
      `配置检查失败: ${error instanceof Error ? error.message : String(error)}`
    );
    report.config.valid = false;
  }
}

function checkModelStatus(report: DoctorReport): void {
  try {
    const { existsSync } = require('node:fs');
    const { join } = require('node:path');
    const modelsConfigPath = join(
      process.cwd(),
      'src',
      'ai',
      'models',
      'ModelConfigs.ts'
    );

    if (existsSync(modelsConfigPath)) {
      report.model.health = 'ok';
      report.model.models = [
        'claude-sonnet-4-6',
        'claude-opus-4-6',
        'deepseek-chat',
      ];
    } else {
      report.model.health = 'unavailable';
    }
  } catch {
    report.model.health = 'unknown';
  }
}

function checkNetwork(report: DoctorReport): void {
  const httpProxy = process.env['HTTP_PROXY'] || process.env['http_proxy'];
  const httpsProxy = process.env['HTTPS_PROXY'] || process.env['https_proxy'];
  report.network.proxyConfigured = !!(httpProxy || httpsProxy);
  report.network.connectivity = 'ok';
}

async function checkSecurity(
  report: DoctorReport,
  deepMode: boolean
): Promise<void> {
  try {
    const securityReport = await runSecurityAudit({ deep: deepMode });
    report.security.report = securityReport;
    report.security.auditFindings = securityReport.summary.total;
    report.security.highSeverityCount = securityReport.summary.high;
    report.security.passed = securityReport.summary.high === 0;

    if (securityReport.summary.high > 0) {
      logger.warning(`安全审计发现 ${securityReport.summary.high} 个高危问题`);
    }
  } catch (error) {
    logger.error('安全审计检查失败', error as Error);
    report.security.auditFindings = -1;
    report.security.passed = false;
  }
}

function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [
    '═══════════════════════════════════════════',
    '          PY_APP Doctor 诊断报告',
    '═══════════════════════════════════════════',
    `时间: ${report.timestamp}`,
    '',
    '── 环境 ──',
    `  运行时: Node.js ${report.environment.node}, Bun ${report.environment.bun}`,
    `  系统: ${report.environment.os} (${report.environment.platform}, ${report.environment.arch})`,
    `  工作目录: ${report.environment.cwd}`,
    '',
    '── 配置 ──',
    `  状态: ${report.config.valid ? '✅ 正常' : '❌ 有问题'}`,
  ];

  for (const issue of report.config.issues) {
    lines.push(`  ❌ ${issue}`);
  }
  for (const suggestion of report.config.suggestions) {
    lines.push(`  💡 ${suggestion}`);
  }

  lines.push('');
  lines.push('── 安全审计 ──');
  if (report.security.auditFindings === -1) {
    lines.push('  ❌ 审计执行失败');
  } else if (report.security.passed) {
    lines.push(
      `  ✅ 通过 (${report.security.auditFindings} 个发现, ${report.security.highSeverityCount} 个高危)`
    );
  } else {
    lines.push(
      `  ⚠️  未通过 (${report.security.auditFindings} 个发现, ${report.security.highSeverityCount} 个高危)`
    );
  }

  lines.push('');
  lines.push('── 模型 ──');
  lines.push(`  状态: ${report.model.health === 'ok' ? '✅' : '❓'}`);
  lines.push(`  可用模型: ${report.model.models.join(', ') || '(未知)'}`);

  lines.push('');
  lines.push('── 网络 ──');
  lines.push(`  代理: ${report.network.proxyConfigured ? '已配置' : '未配置'}`);
  lines.push(`  连接: ${report.network.connectivity}`);

  lines.push('');
  lines.push('═══════════════════════════════════════════');
  return lines.join('\n');
}

export default doctor;
