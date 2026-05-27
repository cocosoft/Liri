/**
 * 启动报告生成器
 * 对标 CC 61+ checkpoint 报告格式
 * 支持 JSON / Text / Markdown 三种输出格式
 */
import {
  type PerformancePhase,
  type PerformanceCheckResult,
  type SLORreport,
} from '../core/performance/SprintPerformanceChecker';
import { STARTUP_PHASES, type StartupPhase } from './StartupChainProfiler';

/** 启动报告条目 */
export interface StartupReportEntry {
  phase: PerformancePhase;
  label: string;
  order: number;
  durationMs: number;
  redlineMs: number;
  status: 'passed' | 'warned' | 'failed';
}

/** 启动报告 */
export interface StartupReport {
  version: string;
  totalStartupMs: number;
  entries: StartupReportEntry[];
  passedCount: number;
  warnedCount: number;
  failedCount: number;
  overallPassed: boolean;
  createdAt: string;
}

/** 分组信息 */
interface GroupInfo {
  name: string;
  startIndex: number;
  endIndex: number;
}

/** 启动阶段分组（用于报告分组展示） */
const PHASE_GROUPS: GroupInfo[] = [
  { name: '核心启动 (Core Boot)', startIndex: 0, endIndex: 3 },
  { name: '模块初始化 (Module Init)', startIndex: 3, endIndex: 10 },
  { name: '插件加载 (Plugin Load)', startIndex: 10, endIndex: 12 },
  { name: '运行环境 (Runtime)', startIndex: 12, endIndex: 17 },
  { name: '延迟加载 (Deferred)', startIndex: 17, endIndex: 18 },
  { name: '就绪 (Ready)', startIndex: 18, endIndex: 19 },
  { name: '运行时 (Runtime)', startIndex: 19, endIndex: 23 },
];

/**
 * 启动报告生成器
 */
export class StartupReportGenerator {
  private sloReport: SLORreport;
  private phaseDurations: Map<PerformancePhase, number>;
  private version: string;

  /**
   * @param sloReport SLO 报告
   * @param phaseDurations 阶段耗时映射
   */
  constructor(
    sloReport: SLORreport,
    phaseDurations: Map<PerformancePhase, number>
  ) {
    this.sloReport = sloReport;
    this.phaseDurations = phaseDurations;
    this.version = sloReport.version;
  }

  /**
   * 生成结构化的启动报告
   */
  generateReport(): StartupReport {
    const entries: StartupReportEntry[] = [];

    let totalStartupMs = 0;

    for (const phase of STARTUP_PHASES) {
      const durationMs = this.phaseDurations.get(phase.name) || 0;
      const result = this.sloReport.results.find((r) => r.phase === phase.name);

      const redlineMs = result?.redlineMs || 0;

      let status: 'passed' | 'warned' | 'failed' = 'passed';
      if (result) {
        status = result.warned ? 'warned' : result.passed ? 'passed' : 'failed';
      }

      entries.push({
        phase: phase.name,
        label: phase.label,
        order: phase.order,
        durationMs,
        redlineMs,
        status,
      });

      totalStartupMs += durationMs;
    }

    const passedCount = entries.filter((e) => e.status === 'passed').length;
    const warnedCount = entries.filter((e) => e.status === 'warned').length;
    const failedCount = entries.filter((e) => e.status === 'failed').length;

    return {
      version: this.version,
      totalStartupMs,
      entries,
      passedCount,
      warnedCount,
      failedCount,
      overallPassed: failedCount === 0,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * 导出为 JSON 字符串
   */
  toJSON(): string {
    return JSON.stringify(this.generateReport(), null, 2);
  }

  /**
   * 导出为纯文本报告
   */
  toText(): string {
    const report = this.generateReport();
    const lines: string[] = [];

    lines.push('='.repeat(72));
    lines.push(`  启动性能报告`);
    lines.push(`  版本: ${report.version}`);
    lines.push(`  总耗时: ${report.totalStartupMs}ms`);
    lines.push(`  状态: ${report.overallPassed ? 'PASSED' : 'FAILED'}`);
    lines.push(
      `  通过: ${report.passedCount} | 警告: ${report.warnedCount} | 失败: ${report.failedCount}`
    );
    lines.push(`  生成时间: ${report.createdAt}`);
    lines.push('='.repeat(72));
    lines.push('');

    for (const group of PHASE_GROUPS) {
      const groupEntries = report.entries.slice(
        group.startIndex,
        group.endIndex
      );
      if (groupEntries.length === 0) continue;

      lines.push(`  ${group.name}`);
      lines.push('  ' + '-'.repeat(68));

      for (const entry of groupEntries) {
        const statusIcon =
          entry.status === 'passed'
            ? 'OK'
            : entry.status === 'warned'
              ? '!!'
              : 'FF';
        const redlineStr = entry.redlineMs > 0 ? `/${entry.redlineMs}ms` : '';
        lines.push(
          `  [${statusIcon}] #${String(entry.order).padStart(2, ' ')} ${entry.label.padEnd(24, ' ')} ${String(entry.durationMs).padStart(6, ' ')}ms${redlineStr}`
        );
      }

      lines.push('');
    }

    if (report.failedCount > 0) {
      lines.push('  !!! 以下阶段超出性能红线:');
      for (const entry of report.entries) {
        if (entry.status === 'failed') {
          lines.push(
            `    - #${entry.order} ${entry.label}: ${entry.durationMs}ms / ${entry.redlineMs}ms`
          );
        }
      }

      lines.push('');
    }

    if (report.warnedCount > 0) {
      lines.push('  ! 以下阶段进入警告区:');
      for (const entry of report.entries) {
        if (entry.status === 'warned') {
          lines.push(
            `    - #${entry.order} ${entry.label}: ${entry.durationMs}ms / ${entry.redlineMs}ms`
          );
        }
      }

      lines.push('');
    }

    lines.push('='.repeat(72));

    return lines.join('\n');
  }

  /**
   * 导出为 Markdown 报告
   */
  toMarkdown(): string {
    const report = this.generateReport();
    const lines: string[] = [];

    lines.push('# 启动性能报告');
    lines.push('');
    lines.push(`| 项目 | 值 |`);
    lines.push(`|------|-----|`);
    lines.push(`| 版本 | ${report.version} |`);
    lines.push(`| 总耗时 | ${report.totalStartupMs}ms |`);
    lines.push(`| 状态 | ${report.overallPassed ? '✅ 通过' : '❌ 未通过'} |`);
    lines.push(
      `| 通过/警告/失败 | ${report.passedCount} / ${report.warnedCount} / ${report.failedCount} |`
    );
    lines.push(`| 生成时间 | ${report.createdAt} |`);
    lines.push('');

    for (const group of PHASE_GROUPS) {
      const groupEntries = report.entries.slice(
        group.startIndex,
        group.endIndex
      );
      if (groupEntries.length === 0) continue;

      lines.push(`## ${group.name}`);
      lines.push('');
      lines.push('| # | 阶段 | 耗时 | 红线 | 状态 |');
      lines.push('|---|------|------|------|------|');

      for (const entry of groupEntries) {
        const statusIcon =
          entry.status === 'passed'
            ? '✅'
            : entry.status === 'warned'
              ? '⚠️'
              : '❌';
        const redlineStr = entry.redlineMs > 0 ? `${entry.redlineMs}ms` : '-';
        lines.push(
          `| ${entry.order} | ${entry.label} | ${entry.durationMs}ms | ${redlineStr} | ${statusIcon} |`
        );
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * 保存报告到文件（自动根据扩展名选择格式）
   * @param dir 保存目录
   * @param format 格式
   * @returns 文件路径
   */
  saveToFile(
    dir: string,
    format: 'json' | 'text' | 'markdown' = 'json'
  ): string {
    const fs = require('node:fs');
    const path = require('node:path');

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const extMap = { json: 'json', text: 'txt', markdown: 'md' };
    const fileName = `startup-report-${dateStr}.${extMap[format]}`;
    const filePath = path.join(dir, fileName);

    let content: string;
    switch (format) {
      case 'json':
        content = this.toJSON();
        break;
      case 'text':
        content = this.toText();
        break;
      case 'markdown':
        content = this.toMarkdown();
        break;
    }

    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');

    return filePath;
  }

  /**
   * 获取最快的 N 个阶段
   */
  getFastestPhases(n: number = 5): StartupReportEntry[] {
    const report = this.generateReport();

    return [...report.entries]
      .sort((a, b) => a.durationMs - b.durationMs)
      .slice(0, n);
  }

  /**
   * 获取最慢的 N 个阶段
   */
  getSlowestPhases(n: number = 5): StartupReportEntry[] {
    const report = this.generateReport();

    return [...report.entries]
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, n);
  }
}
