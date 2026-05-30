#!/usr/bin/env bun
import { runSecurityAudit } from '../security/audit/index.js';

async function main() {
  console.log('=== 安全扫描开始 ===\n');

  const report = await runSecurityAudit({
    deep: true,
    includeFilesystem: true,
    includePlugins: true,
  });

  console.log(`扫描文件数: ${report.summary.total}`);
  console.log(`发现 HIGH 风险: ${report.summary.high}`);
  console.log(`发现 MEDIUM 风险: ${report.summary.medium}`);
  console.log(`发现 LOW 风险: ${report.summary.low}`);
  console.log(`耗时: ${report.durationMs}ms\n`);

  if (report.findings.length > 0) {
    console.log('=== 发现详情 ===');
    for (const finding of report.findings) {
      const icon =
        finding.severity === 'HIGH'
          ? '🔴'
          : finding.severity === 'MEDIUM'
            ? '🟡'
            : '🟢';
      console.log(`${icon} [${finding.severity}] ${finding.message}`);
      if (finding.remediation) {
        console.log(`   修复建议: ${finding.remediation}`);
      }
      console.log('');
    }
  }

  console.log(
    `\n⚠️ 共发现 ${report.summary.total} 个问题 (HIGH:${report.summary.high} MEDIUM:${report.summary.medium} LOW:${report.summary.low})`
  );
  console.log('📋 详情已输出至上方日志，请开发人员关注 HIGH 风险项');
  process.exit(0);
}

main().catch((error) => {
  console.error('安全扫描失败:', error);
  process.exit(1);
});
