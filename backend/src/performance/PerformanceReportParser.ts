/**
 * 公开制品机制 — 轻量级性能报告解析器
 *
 * 提供多种格式的性能报告输出：
 * - 纯文本摘要（console/text）
 * - JSON 结构化数据（适合存档和分析）
 * - Markdown 格式（适合文档和分享）
 * - 慢阶段筛选（用于定位瓶颈）
 */

import { TraceReport, TracePoint } from './StartupTracer';
import { DeferredLoadState } from '@modules/modules/LazyModuleStrategy';
import { PerformanceDashboard, SnapshotComparison } from './PerformanceMonitor';

/**
 * 解析后的阶段节点
 */
export interface PhaseNode {
  name: string;
  duration: number;
  ratio: number;
  children?: PhaseNode[];
}

/**
 * 性能报告解析器
 */
export class PerformanceReportParser {
  /**
   * 将 TraceReport 解析为纯文本格式
   */
  static toText(report: TraceReport): string {
    const lines: string[] = ['启动性能报告', '=============='];

    for (const point of report.points) {
      const duration =
        point.duration !== null ? `${point.duration.toFixed(1)}ms` : '进行中';
      lines.push(`  ${point.phase}: ${duration}`);
    }

    lines.push('');
    lines.push(`总阶段数: ${report.points.length}`);
    lines.push(`已完成阶段: ${report.phaseSummary.length}`);
    lines.push(`最大阶段耗时: ${report.totalDuration.toFixed(1)}ms`);

    if (report.phaseSummary.length > 0) {
      lines.push('');
      lines.push('耗时排名:');
      for (let i = 0; i < report.phaseSummary.length; i++) {
        const s = report.phaseSummary[i];
        lines.push(
          `  ${i + 1}. ${s.phase}: ${s.duration.toFixed(1)}ms (${(s.ratio * 100).toFixed(1)}%)`
        );
      }
    }

    return lines.join('\n');
  }

  /**
   * 将 TraceReport 解析为 Markdown 表格格式
   */
  static toMarkdown(report: TraceReport): string {
    const lines: string[] = [
      '# 启动性能报告',
      '',
      '## 阶段耗时',
      '',
      '| 阶段 | 耗时（ms） | 占比 |',
      '|------|-----------|------|',
    ];

    for (const summary of report.phaseSummary) {
      lines.push(
        `| ${summary.phase} | ${summary.duration.toFixed(1)} | ${(summary.ratio * 100).toFixed(1)}% |`
      );
    }

    lines.push('');
    lines.push(`**总追踪点数**: ${report.points.length}`);
    lines.push(`**最大阶段耗时**: ${report.totalDuration.toFixed(1)}ms`);

    return lines.join('\n');
  }

  /**
   * 将 TraceReport 解析为 JSON 兼容对象
   */
  static toJSON(report: TraceReport): object {
    return {
      generatedAt: new Date().toISOString(),
      totalDuration: report.totalDuration,
      phaseCount: report.points.length,
      completedPhaseCount: report.phaseSummary.length,
      phases: report.phaseSummary.map((s) => ({
        phase: s.phase,
        durationMs: Math.round(s.duration * 100) / 100,
        ratio: Math.round(s.ratio * 1000) / 1000,
      })),
      rawPoints: report.points.map((p) => ({
        phase: p.phase,
        startTime: p.startTime,
        endTime: p.endTime,
        duration:
          p.duration !== null ? Math.round(p.duration * 100) / 100 : null,
      })),
    };
  }

  /**
   * 筛选耗时超过阈值的阶段（用于定位瓶颈）
   *
   * @param report - 性能报告
   * @param thresholdMs - 耗时阈值
   */
  static getSlowPhases(
    report: TraceReport,
    thresholdMs: number
  ): Array<{ phase: string; duration: number; ratio: number }> {
    return report.phaseSummary.filter((s) => s.duration > thresholdMs);
  }

  /**
   * 生成延迟模块加载的摘要文本
   */
  static deferredLoadSummary(states: DeferredLoadState[]): string {
    const total = states.length;
    const loaded = states.filter((s) => s.status === 'loaded').length;
    const pending = states.filter((s) => s.status === 'pending').length;
    const failed = states.filter((s) => s.status === 'error').length;

    const lines: string[] = [
      '延迟模块加载摘要',
      '==================',
      `总数: ${total} | 已加载: ${loaded} | 待加载: ${pending} | 失败: ${failed}`,
      '',
    ];

    if (states.length > 0) {
      lines.push('详细状态:');
      for (const state of states) {
        const duration =
          state.startTime && state.endTime
            ? `${state.endTime - state.startTime}ms`
            : '-';
        const errorInfo = state.error ? ` (错误: ${state.error.message})` : '';
        lines.push(
          `  ${state.moduleId}: ${state.status} (${duration})${errorInfo}`
        );
      }
    }

    return lines.join('\n');
  }

  /**
   * 生成综合仪表盘文本报告
   * 整合启动性能、BATCH 延迟加载、ON_DEMAND 按需加载等所有性能维度
   */
  static toDashboard(dashboard: PerformanceDashboard): string {
    const lines: string[] = [
      '========== 性能监控面板 ==========',
      `报告时间: ${new Date(dashboard.timestamp).toISOString()}`,
      '',
      '--- 启动性能 ---',
      `  总耗时: ${dashboard.startup.totalDuration.toFixed(1)}ms`,
      `  追踪阶段: ${dashboard.startup.completedPhaseCount}/${dashboard.startup.phaseCount}`,
      '',
    ];

    if (dashboard.startup.slowPhases.length > 0) {
      lines.push('  耗时较高阶段:');
      for (const phase of dashboard.startup.slowPhases) {
        lines.push(
          `    ${phase.phase}: ${phase.duration.toFixed(1)}ms (${(phase.ratio * 100).toFixed(1)}%)`
        );
      }
      lines.push('');
    }

    lines.push('--- 关键指标 ---');
    for (const [key, value] of Object.entries(dashboard.phaseSummary)) {
      if (value !== null) {
        lines.push(`  ${key}: ${value.toFixed(1)}ms`);
      }
    }
    lines.push('');

    const dl = dashboard.deferredLoading;
    lines.push('--- BATCH 延迟模块 ---');
    lines.push(
      `  总数: ${dl.total} | 已加载: ${dl.loaded} | 待加载: ${dl.pending} | 失败: ${dl.failed}`
    );
    if (dl.allLoaded) {
      lines.push('  状态: 全部加载完成');
    }
    lines.push('');

    const od = dashboard.onDemandLoading;
    lines.push('--- ON_DEMAND 按需加载 ---');
    lines.push(`  已按需加载: ${od.loadedCount} 个模块`);
    if (od.modules.length > 0) {
      lines.push(`  按需加载总耗时: ${od.totalDuration.toFixed(1)}ms`);
      for (const mod of od.modules) {
        lines.push(`  ${mod.moduleId}: ${mod.duration.toFixed(1)}ms`);
      }
    }
    lines.push('');

    lines.push('================================');

    return lines.join('\n');
  }

  /**
   * 生成快照对比文本报告
   * 展示两个快照之间的性能差异，按变化幅度排序
   */
  static toComparison(comparison: SnapshotComparison): string {
    const lines: string[] = [
      '========== 性能快照对比 ==========',
      `基准: ${comparison.baseline.label} (${new Date(comparison.baseline.timestamp).toISOString()})`,
      `目标: ${comparison.target.label} (${new Date(comparison.target.timestamp).toISOString()})`,
      '',
    ];

    const sign = comparison.startupDiff.totalDurationChange >= 0 ? '+' : '';
    lines.push(
      `启动总耗时变化: ${sign}${comparison.startupDiff.totalDurationChange.toFixed(1)}ms (${sign}${comparison.startupDiff.totalDurationChangePercent.toFixed(1)}%)`
    );
    lines.push('');

    if (comparison.startupDiff.phaseChanges.length > 0) {
      lines.push('--- 阶段变化 (按变化幅度排序) ---');
      for (const pc of comparison.startupDiff.phaseChanges) {
        const s = pc.change >= 0 ? '+' : '';
        lines.push(
          `  ${pc.phase}: ${pc.baselineDuration.toFixed(1)}ms → ${pc.targetDuration.toFixed(1)}ms (${s}${pc.change.toFixed(1)}ms, ${s}${pc.changePercent.toFixed(1)}%)`
        );
      }
      lines.push('');
    }

    lines.push('--- 延迟加载变化 ---');
    lines.push(
      `  BATCH: ${comparison.deferredDiff.baselineLoaded} → ${comparison.deferredDiff.targetLoaded} (${comparison.deferredDiff.loadedChange >= 0 ? '+' : ''}${comparison.deferredDiff.loadedChange})`
    );
    lines.push(
      `  ON_DEMAND: ${comparison.onDemandDiff.baselineCount} → ${comparison.onDemandDiff.targetCount} (${comparison.onDemandDiff.countChange >= 0 ? '+' : ''}${comparison.onDemandDiff.countChange})`
    );
    lines.push('');

    lines.push('==================================');

    return lines.join('\n');
  }
}
