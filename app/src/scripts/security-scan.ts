#!/usr/bin/env bun
import { runSecurityAudit } from '../security/audit/index.js';

const isCi = process.argv.includes("--ci");

// CI 模式下的阈值配置
const THRESHOLDS = {
  HIGH: 0,     // HIGH 风险超过 0 个即失败
  MEDIUM: 10,  // MEDIUM 风险超过 10 个即失败
};

async function main() {
  console.log('=== 安全扫描开始 ===\n');

  const report = await runSecurityAudit({
    deep: true,
    includeFilesystem: true,
    includePlugins: true,
  });

  const { total, high, medium, low } = report.summary;

  console.log(`扫描文件数: ${total}`);
  console.log(`发现 HIGH 风险: ${high}`);
  console.log(`发现 MEDIUM 风险: ${medium}`);
  console.log(`发现 LOW 风险: ${low}`);
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
    `\n⚠️ 共发现 ${total} 个问题 (HIGH:${high} MEDIUM:${medium} LOW:${low})`,
  );

  // CI 模式下检查阈值
  if (isCi) {
    const failures: string[] = [];
    if (high > THRESHOLDS.HIGH) {
      failures.push(
        `HIGH 风险 ${high} 个超过阈值 ${THRESHOLDS.HIGH}`,
      );
    }
    if (medium > THRESHOLDS.MEDIUM) {
      failures.push(
        `MEDIUM 风险 ${medium} 个超过阈值 ${THRESHOLDS.MEDIUM}`,
      );
    }
    if (failures.length > 0) {
      console.log('\n❌ CI 安全扫描未通过:');
      for (const msg of failures) {
        console.log(`   - ${msg}`);
      }
      process.exit(1);
    }
    console.log('\n✅ CI 安全扫描通过，所有风险项在阈值范围内');
  } else {
    console.log('📋 详情已输出至上方日志，请开发人员关注 HIGH 风险项');
  }
  process.exit(0);
}

main().catch((error) => {
  console.error('安全扫描失败:', error);
  process.exit(1);
});
