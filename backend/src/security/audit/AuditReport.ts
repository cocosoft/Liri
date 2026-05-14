/**
 * 审计报告生成模块
 * 汇总所有审计维度发现，生成统一格式的安全审计报告
 * 对齐 OpenClaw security/audit.types.ts 的 SecurityAuditReport 结构
 */

import type {
  SecurityAuditFinding,
  SecurityAuditSummary,
  SecurityAuditReport,
  AuditCategory,
} from './AuditTypes';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 生成审计摘要
 */
export function buildAuditSummary(
  findings: SecurityAuditFinding[]
): SecurityAuditSummary {
  const summary: SecurityAuditSummary = {
    high: 0,
    medium: 0,
    low: 0,
    total: findings.length,
    categories: {} as Record<AuditCategory, number>,
  };

  for (const finding of findings) {
    // 按严重性计数
    switch (finding.severity) {
      case 'HIGH':
        summary.high++;
        break;
      case 'MEDIUM':
        summary.medium++;
        break;
      case 'LOW':
        summary.low++;
        break;
    }

    // 按类别计数
    const cat = finding.category;
    summary.categories[cat] = (summary.categories[cat] || 0) + 1;
  }

  return summary;
}

/**
 * 构建完整审计报告
 */
export function buildAuditReport(
  allFindings: SecurityAuditFinding[],
  startTime: number,
  deepFindings?: {
    codeSafetyFindings?: SecurityAuditFinding[];
    probeFindings?: SecurityAuditFinding[];
    sandboxFindings?: SecurityAuditFinding[];
  }
): SecurityAuditReport {
  const summary = buildAuditSummary(allFindings);
  const durationMs = Date.now() - startTime;

  const report: SecurityAuditReport = {
    summary,
    findings: allFindings,
    timestamp: new Date().toISOString(),
    durationMs,
  };

  if (deepFindings) {
    report.deep = {
      codeSafetyFindings: deepFindings.codeSafetyFindings || [],
      probeFindings: deepFindings.probeFindings || [],
      sandboxFindings: deepFindings.sandboxFindings || [],
    };
  }

  logger.info(
    `审计报告生成: ${summary.total} 个发现 (HIGH:${summary.high} MEDIUM:${summary.medium} LOW:${summary.low}), 耗时 ${durationMs}ms`
  );

  return report;
}

/**
 * 格式化审计报告为可读文本
 */
export function formatAuditReport(report: SecurityAuditReport): string {
  const lines: string[] = [
    '═══════════════════════════════════════════',
    '          PY_APP 安全审计报告',
    '═══════════════════════════════════════════',
    `时间: ${report.timestamp}`,
    `耗时: ${report.durationMs}ms`,
    '',
    '── 摘要 ──',
    `  HIGH:   ${report.summary.high}`,
    `  MEDIUM: ${report.summary.medium}`,
    `  LOW:    ${report.summary.low}`,
    `  总计:   ${report.summary.total}`,
    '',
  ];

  if (report.findings.length === 0) {
    lines.push('  ✅ 未发现安全问题');
    lines.push('');
    lines.push('═══════════════════════════════════════════');
    return lines.join('\n');
  }

  // 按严重性分组
  const severityOrder: Array<'HIGH' | 'MEDIUM' | 'LOW'> = [
    'HIGH',
    'MEDIUM',
    'LOW',
  ];
  for (const severity of severityOrder) {
    const group = report.findings.filter((f) => f.severity === severity);
    if (group.length === 0) continue;
    lines.push(`── ${severity} (${group.length}) ──`);
    for (const f of group) {
      lines.push(`  [${f.id}] ${f.message}`);
      if (f.path) lines.push(`    路径: ${f.path}`);
      lines.push(`    修复: ${f.remediation}`);
      lines.push('');
    }
  }

  lines.push('═══════════════════════════════════════════');
  return lines.join('\n');
}
