/**
 * 性能监控面板
 *
 * 提供轻量级的性能数据查询接口：
 * - 查询启动性能报告（来自 StartupTracer）
 * - 查询延迟模块加载状态（来自 DeferredLoader）
 * - 查询按需动态加载模块状态（ON_DEMAND 模式）
 * - 保存/加载历史快照，支持性能对比分析
 * - 输出仪表盘式文本报告
 */

import { startupTracer, TraceReport } from './StartupTracer';
import {
  deferredLoader,
  DeferredLoadState,
} from '@modules/modules/LazyModuleStrategy';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 延迟模块加载统计
 */
export interface DeferredLoadStats {
  total: number;
  loaded: number;
  pending: number;
  failed: number;
  allLoaded: boolean;
  states: DeferredLoadState[];
}

/**
 * 按需动态加载模块统计
 */
export interface OnDemandLoadStats {
  /** 已按需加载的模块数量 */
  loadedCount: number;
  /** 各模块加载详情 */
  modules: Array<{
    moduleId: string;
    duration: number;
  }>;
  /** 总耗时 */
  totalDuration: number;
}

/**
 * 综合仪表盘报告
 */
export interface PerformanceDashboard {
  /** 报告生成时间戳 */
  timestamp: number;
  /** 启动性能摘要 */
  startup: {
    totalDuration: number;
    phaseCount: number;
    completedPhaseCount: number;
    slowPhases: Array<{ phase: string; duration: number; ratio: number }>;
  };
  /** BATCH 延迟模块加载统计 */
  deferredLoading: DeferredLoadStats;
  /** ON_DEMAND 按需模块加载统计 */
  onDemandLoading: OnDemandLoadStats;
  /** 关键阶段耗时摘要 */
  phaseSummary: Record<string, number | null>;
}

/**
 * 历史快照
 */
export interface PerformanceSnapshot {
  id: string;
  label: string;
  timestamp: number;
  dashboard: PerformanceDashboard;
}

/**
 * 快照对比结果
 */
export interface SnapshotComparison {
  baseline: { id: string; label: string; timestamp: number };
  target: { id: string; label: string; timestamp: number };
  startupDiff: {
    totalDurationChange: number;
    totalDurationChangePercent: number;
    phaseChanges: Array<{
      phase: string;
      baselineDuration: number;
      targetDuration: number;
      change: number;
      changePercent: number;
    }>;
  };
  deferredDiff: {
    baselineLoaded: number;
    targetLoaded: number;
    loadedChange: number;
  };
  onDemandDiff: {
    baselineCount: number;
    targetCount: number;
    countChange: number;
  };
}

/**
 * 性能监控面板
 */
export class PerformanceMonitor {
  private static instance: PerformanceMonitor;
  private snapshots: Map<string, PerformanceSnapshot> = new Map();
  private snapshotCounter = 0;

  static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor();
    }
    return PerformanceMonitor.instance;
  }

  /**
   * 获取启动性能报告
   */
  getStartupReport(): TraceReport {
    return startupTracer.getReport();
  }

  /**
   * 获取指定阶段的耗时（毫秒）
   */
  getPhaseDuration(phase: string): number | null {
    return startupTracer.getPhaseDuration(phase);
  }

  /**
   * 获取 BATCH 模式延迟模块加载统计
   */
  getDeferredLoadStats(): DeferredLoadStats {
    const states = deferredLoader.getStates();

    return {
      total: states.length,
      loaded: deferredLoader.getLoadedCount(),
      pending: deferredLoader.getPendingCount(),
      failed: deferredLoader.getErrorCount(),
      allLoaded: deferredLoader.isAllLoaded(),
      states,
    };
  }

  /**
   * 获取 ON_DEMAND 模式按需模块加载统计
   * 从 StartupTracer 中提取 on_demand:* 阶段的耗时信息
   */
  getOnDemandLoadStats(): OnDemandLoadStats {
    const report = startupTracer.getReport();
    const onDemandPoints = report.points.filter((p) =>
      p.phase.startsWith('on_demand:')
    );

    const modules = onDemandPoints
      .filter((p) => p.duration !== null)
      .map((p) => ({
        moduleId: p.phase.replace('on_demand:', ''),
        duration: p.duration!,
      }))
      .sort((a, b) => b.duration - a.duration);

    const totalDuration = modules.reduce((sum, m) => sum + m.duration, 0);

    return {
      loadedCount: modules.length,
      modules,
      totalDuration,
    };
  }

  /**
   * 获取延迟超过阈值的 BATCH 模块列表
   *
   * @param thresholdMs - 耗时阈值，默认 500ms
   */
  getSlowModules(thresholdMs = 500): DeferredLoadState[] {
    return deferredLoader
      .getStates()
      .filter(
        (s) =>
          s.status === 'loaded' &&
          s.startTime &&
          s.endTime &&
          s.endTime - s.startTime > thresholdMs
      );
  }

  /**
   * 获取启动关键指标摘要
   */
  getStartupSummary(): Record<string, number | null> {
    return {
      total: startupTracer.getPhaseDuration('launch_total'),
      t0_preroll: startupTracer.getPhaseDuration('T0_preroll'),
      t1_moduleInit: startupTracer.getPhaseDuration('T1_module_init'),
      t1_awaitPrefetch: startupTracer.getPhaseDuration('T1_await_prefetch'),
      t2_dispatch: startupTracer.getPhaseDuration('T2_dispatch'),
      essentialModules: startupTracer.getPhaseDuration(
        'essential_modules_init'
      ),
    };
  }

  /**
   * 获取综合仪表盘报告
   * 整合启动性能、延迟加载、按需加载等所有性能维度
   */
  getDashboardReport(): PerformanceDashboard {
    const report = this.getStartupReport();
    const deferredStats = this.getDeferredLoadStats();
    const onDemandStats = this.getOnDemandLoadStats();
    const summary = this.getStartupSummary();

    const slowPhases = report.phaseSummary
      .filter((s) => s.duration > 100)
      .slice(0, 10);

    return {
      timestamp: Date.now(),
      startup: {
        totalDuration: report.totalDuration,
        phaseCount: report.points.length,
        completedPhaseCount: report.phaseSummary.length,
        slowPhases,
      },
      deferredLoading: deferredStats,
      onDemandLoading: onDemandStats,
      phaseSummary: summary,
    };
  }

  /**
   * 保存当前性能快照
   *
   * @param label - 快照标签，例如 'v1.0 基线'、'优化后'
   * @returns 快照 ID
   */
  saveSnapshot(label: string): string {
    this.snapshotCounter++;
    const id = `snap_${Date.now()}_${this.snapshotCounter}`;
    const snapshot: PerformanceSnapshot = {
      id,
      label,
      timestamp: Date.now(),
      dashboard: this.getDashboardReport(),
    };

    this.snapshots.set(id, snapshot);
    logger.info(`性能快照已保存: ${label} (${id})`);
    return id;
  }

  /**
   * 加载历史快照
   */
  loadSnapshot(id: string): PerformanceSnapshot | undefined {
    return this.snapshots.get(id);
  }

  /**
   * 获取所有快照列表
   */
  listSnapshots(): PerformanceSnapshot[] {
    return Array.from(this.snapshots.values()).sort((a, b) => {
      if (b.timestamp !== a.timestamp) {
        return b.timestamp - a.timestamp;
      }
      return b.id.localeCompare(a.id);
    });
  }

  /**
   * 删除快照
   */
  deleteSnapshot(id: string): boolean {
    return this.snapshots.delete(id);
  }

  /**
   * 对比两个快照的性能差异
   *
   * @param baselineId - 基准快照 ID
   * @param targetId - 目标快照 ID
   */
  compareSnapshots(
    baselineId: string,
    targetId: string
  ): SnapshotComparison | null {
    const baseline = this.snapshots.get(baselineId);
    const target = this.snapshots.get(targetId);

    if (!baseline || !target) {
      logger.warn('快照对比失败：未找到指定的快照');
      return null;
    }

    const b = baseline.dashboard;
    const t = target.dashboard;

    // 启动总耗时变化
    const totalDurationChange =
      t.startup.totalDuration - b.startup.totalDuration;
    const totalDurationChangePercent =
      b.startup.totalDuration > 0
        ? (totalDurationChange / b.startup.totalDuration) * 100
        : 0;

    // 各阶段耗时变化
    const phaseChanges: SnapshotComparison['startupDiff']['phaseChanges'] = [];
    const allPhases = new Set([
      ...Object.keys(b.phaseSummary),
      ...Object.keys(t.phaseSummary),
    ]);

    for (const phase of allPhases) {
      const baselineDuration = b.phaseSummary[phase];
      const targetDuration = t.phaseSummary[phase];

      if (baselineDuration !== null && targetDuration !== null) {
        const change = targetDuration - baselineDuration;
        const changePercent =
          baselineDuration > 0 ? (change / baselineDuration) * 100 : 0;

        phaseChanges.push({
          phase,
          baselineDuration,
          targetDuration,
          change,
          changePercent,
        });
      }
    }

    phaseChanges.sort(
      (a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent)
    );

    return {
      baseline: {
        id: baseline.id,
        label: baseline.label,
        timestamp: baseline.timestamp,
      },
      target: {
        id: target.id,
        label: target.label,
        timestamp: target.timestamp,
      },
      startupDiff: {
        totalDurationChange,
        totalDurationChangePercent,
        phaseChanges,
      },
      deferredDiff: {
        baselineLoaded: b.deferredLoading.loaded,
        targetLoaded: t.deferredLoading.loaded,
        loadedChange: t.deferredLoading.loaded - b.deferredLoading.loaded,
      },
      onDemandDiff: {
        baselineCount: b.onDemandLoading.loadedCount,
        targetCount: t.onDemandLoading.loadedCount,
        countChange:
          t.onDemandLoading.loadedCount - b.onDemandLoading.loadedCount,
      },
    };
  }

  /**
   * 输出综合仪表盘到日志
   */
  logDashboard(): void {
    const dashboard = this.getDashboardReport();

    logger.info('\n========== 性能监控面板 ==========');

    // 启动性能
    logger.info('--- 启动性能 ---');
    logger.info(`  总耗时: ${dashboard.startup.totalDuration.toFixed(1)}ms`);
    logger.info(
      `  追踪阶段: ${dashboard.startup.completedPhaseCount}/${dashboard.startup.phaseCount}`
    );

    if (dashboard.startup.slowPhases.length > 0) {
      logger.info('  耗时较高阶段:');
      for (const phase of dashboard.startup.slowPhases) {
        logger.info(
          `    ${phase.phase}: ${phase.duration.toFixed(1)}ms (${(phase.ratio * 100).toFixed(1)}%)`
        );
      }
    }

    // 关键指标
    logger.info('--- 关键指标 ---');
    for (const [key, value] of Object.entries(dashboard.phaseSummary)) {
      if (value !== null) {
        logger.info(`  ${key}: ${value.toFixed(1)}ms`);
      }
    }

    // BATCH 延迟加载
    const dl = dashboard.deferredLoading;
    logger.info('--- BATCH 延迟模块 ---');
    logger.info(
      `  总数: ${dl.total} | 已加载: ${dl.loaded} | 待加载: ${dl.pending} | 失败: ${dl.failed}`
    );
    if (dl.allLoaded) {
      logger.info('  状态: 全部加载完成');
    }

    // ON_DEMAND 按需加载
    const od = dashboard.onDemandLoading;
    logger.info('--- ON_DEMAND 按需加载 ---');
    logger.info(`  已按需加载: ${od.loadedCount} 个模块`);
    if (od.modules.length > 0) {
      logger.info(`  按需加载总耗时: ${od.totalDuration.toFixed(1)}ms`);
      for (const mod of od.modules) {
        logger.info(`  ${mod.moduleId}: ${mod.duration.toFixed(1)}ms`);
      }
    }

    logger.info('================================\n');
  }

  /**
   * 输出快照对比到日志
   */
  logComparison(baselineId: string, targetId: string): void {
    const comparison = this.compareSnapshots(baselineId, targetId);
    if (!comparison) {
      logger.warn('快照对比失败');
      return;
    }

    logger.info('\n========== 性能快照对比 ==========');
    logger.info(
      `基准: ${comparison.baseline.label} (${new Date(comparison.baseline.timestamp).toISOString()})`
    );
    logger.info(
      `目标: ${comparison.target.label} (${new Date(comparison.target.timestamp).toISOString()})`
    );

    const sign = comparison.startupDiff.totalDurationChange >= 0 ? '+' : '';
    logger.info(
      `启动总耗时变化: ${sign}${comparison.startupDiff.totalDurationChange.toFixed(1)}ms (${sign}${comparison.startupDiff.totalDurationChangePercent.toFixed(1)}%)`
    );

    if (comparison.startupDiff.phaseChanges.length > 0) {
      logger.info('--- 阶段变化 (按变化幅度排序) ---');
      for (const pc of comparison.startupDiff.phaseChanges) {
        const s = pc.change >= 0 ? '+' : '';
        logger.info(
          `  ${pc.phase}: ${pc.baselineDuration.toFixed(1)}ms → ${pc.targetDuration.toFixed(1)}ms (${s}${pc.change.toFixed(1)}ms, ${s}${pc.changePercent.toFixed(1)}%)`
        );
      }
    }

    logger.info('--- 延迟加载变化 ---');
    logger.info(
      `  BATCH: ${comparison.deferredDiff.baselineLoaded} → ${comparison.deferredDiff.targetLoaded} (${comparison.deferredDiff.loadedChange >= 0 ? '+' : ''}${comparison.deferredDiff.loadedChange})`
    );
    logger.info(
      `  ON_DEMAND: ${comparison.onDemandDiff.baselineCount} → ${comparison.onDemandDiff.targetCount} (${comparison.onDemandDiff.countChange >= 0 ? '+' : ''}${comparison.onDemandDiff.countChange})`
    );

    logger.info('==================================\n');
  }
}

/** 全局性能监控实例 */
export const performanceMonitor = PerformanceMonitor.getInstance();
