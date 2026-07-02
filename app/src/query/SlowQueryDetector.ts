/**
 * 慢查询检测器
 * 检测执行时间超过阈值的查询，输出 WARN 日志并生成报告
 */

import { Logger } from '@modules/monitoring';
import { getQueryLogStore } from './QueryLogStore';
import type { QueryLogStore } from './QueryLogStore';
import type { QueryLogEntry, QueryLogStats } from './QueryLogTypes';

const logger = new Logger({ module: 'query:slowQuery' });

/** 默认慢查询阈值（毫秒） */
const DEFAULT_SLOW_THRESHOLD_MS = 5000;

/** 默认统计时间范围（毫秒，最近1小时） */
const DEFAULT_STATS_WINDOW_MS = 3600_000;

/**
 * 慢查询记录
 */
export interface SlowQueryRecord {
  /** 日志条目 */
  entry: QueryLogEntry;

  /** 超过阈值倍数 */
  thresholdMultiplier: number;
}

/**
 * 慢查询报告
 */
export interface SlowQueryReport {
  /** 慢查询数量 */
  totalSlowQueries: number;

  /** 慢查询列表（按耗时降序排列） */
  slowQueries: SlowQueryRecord[];

  /** 整体统计 */
  stats: QueryLogStats;

  /** 阈值（毫秒） */
  thresholdMs: number;

  /** 报告时间范围起始 */
  startTime: number;

  /** 报告时间范围结束 */
  endTime: number;

  /** 最慢的查询耗时（毫秒） */
  maxDurationMs: number;

  /** 平均慢查询耗时（毫秒） */
  avgSlowDurationMs: number;
}

/**
 * 慢查询检测器
 */
export class SlowQueryDetector {
  private thresholdMs: number;
  private statsWindowMs: number;
  private store: QueryLogStore;

  /**
   * @param thresholdMs 慢查询阈值（默认 5000ms）
   * @param statsWindowMs 统计时间窗口（默认 1小时）
   * @param store QueryLogStore 实例（可选，默认使用全局单例）
   */
  constructor(
    thresholdMs: number = DEFAULT_SLOW_THRESHOLD_MS,
    statsWindowMs: number = DEFAULT_STATS_WINDOW_MS,
    store?: QueryLogStore
  ) {
    this.thresholdMs = thresholdMs;
    this.statsWindowMs = statsWindowMs;
    this.store = store || getQueryLogStore();
  }

  /**
   * 设置慢查询阈值
   */
  setThreshold(ms: number): void {
    this.thresholdMs = ms;
  }

  /**
   * 获取当前阈值
   */
  getThreshold(): number {
    return this.thresholdMs;
  }

  /**
   * 设置统计时间窗口
   */
  setStatsWindow(ms: number): void {
    this.statsWindowMs = ms;
  }

  /**
   * 检查并报告慢查询
   * 查询 QueryLogStore 中最近时间窗口内的日志，输出 WARN 日志
   */
  async checkSlowQueries(): Promise<SlowQueryRecord[]> {
    await this.store.init();

    const endTime = Date.now();
    const startTime = endTime - this.statsWindowMs;

    const entries = await this.store.query({
      type: 'api_call',
      startTime,
      endTime,
      limit: 1000,
    });

    const slowQueries: SlowQueryRecord[] = [];

    for (const entry of entries) {
      if (entry.durationMs > this.thresholdMs) {
        const multiplier = parseFloat(
          (entry.durationMs / this.thresholdMs).toFixed(1)
        );
        slowQueries.push({ entry, thresholdMultiplier: multiplier });

        logger.warn('检测到慢查询', {
          sessionId: entry.sessionId,
          model: entry.model,
          durationMs: entry.durationMs,
          thresholdMs: this.thresholdMs,
          multiplier,
          timestamp: entry.timestamp,
          error: entry.error,
        });
      }
    }

    if (slowQueries.length > 0) {
      slowQueries.sort((a, b) => b.entry.durationMs - a.entry.durationMs);
    }

    return slowQueries;
  }

  /**
   * 生成慢查询报告
   */
  async generateReport(): Promise<SlowQueryReport> {
    await this.store.init();

    const endTime = Date.now();
    const startTime = endTime - this.statsWindowMs;

    const [stats, slowQueries] = await Promise.all([
      this.store.getStats(startTime, endTime),
      this.checkSlowQueries(),
    ]);

    const totalDuration = slowQueries.reduce(
      (sum, q) => sum + q.entry.durationMs,
      0
    );
    const avgSlowDurationMs =
      slowQueries.length > 0
        ? Math.round(totalDuration / slowQueries.length)
        : 0;
    const maxDurationMs =
      slowQueries.length > 0 ? slowQueries[0].entry.durationMs : 0;

    return {
      totalSlowQueries: slowQueries.length,
      slowQueries,
      stats,
      thresholdMs: this.thresholdMs,
      startTime,
      endTime,
      maxDurationMs,
      avgSlowDurationMs,
    };
  }

  /**
   * 打印慢查询报告到控制台
   */
  async printReport(): Promise<void> {
    const report = await this.generateReport();

    const { default: chalk } = await import('chalk');

    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold('  慢查询检测报告'));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log();

    console.log(
      `${chalk.gray('统计时间范围:')} ${new Date(report.startTime).toLocaleString()} ~ ${new Date(report.endTime).toLocaleString()}`
    );
    console.log(`${chalk.gray('慢查询阈值:')} ${report.thresholdMs}ms`);
    console.log();

    console.log(chalk.bold('整体统计:'));
    console.log(
      `  ${chalk.gray('总 API 调用:')} ${report.stats.totalApiCalls}`
    );
    console.log(
      `  ${chalk.gray('平均耗时:')} ${report.stats.avgApiDurationMs}ms`
    );
    console.log(
      `  ${chalk.gray('API 成功率:')} ${(report.stats.apiSuccessRate * 100).toFixed(1)}%`
    );
    console.log(`  ${chalk.gray('总 Token:')} ${report.stats.totalTokens}`);
    console.log(
      `  ${chalk.gray('总工具调用:')} ${report.stats.totalToolCalls}`
    );
    console.log();

    if (report.totalSlowQueries === 0) {
      console.log(chalk.green('✓ 未检测到慢查询'));
    } else {
      console.log(chalk.yellow(`⚠ 检测到 ${report.totalSlowQueries} 个慢查询`));
      console.log(`  ${chalk.gray('最慢:')} ${report.maxDurationMs}ms`);
      console.log(
        `  ${chalk.gray('平均慢查询耗时:')} ${report.avgSlowDurationMs}ms`
      );
      console.log();

      console.log(chalk.bold('慢查询列表:'));
      for (let i = 0; i < Math.min(report.slowQueries.length, 20); i++) {
        const sq = report.slowQueries[i];
        const level =
          sq.thresholdMultiplier >= 3
            ? chalk.red
            : sq.thresholdMultiplier >= 2
              ? chalk.yellow
              : chalk.white;
        console.log(
          `  ${i + 1}. ${level(`${sq.entry.durationMs}ms`)} ${chalk.gray('(x' + sq.thresholdMultiplier + ' 阈值)')}`
        );
        console.log(
          `     ${chalk.gray('会话:')} ${sq.entry.sessionId}  ${chalk.gray('模型:')} ${sq.entry.model || 'N/A'}  ${chalk.gray('成功:')} ${sq.entry.success ? '是' : '否'}`
        );
        if (sq.entry.error) {
          console.log(
            `     ${chalk.gray('错误:')} ${chalk.red(sq.entry.error)}`
          );
        }
      }
      if (report.slowQueries.length > 20) {
        console.log(
          `  ${chalk.gray('... 还有')} ${report.slowQueries.length - 20} 条`
        );
      }
    }

    console.log(chalk.cyan('═'.repeat(60)));
  }
}
