import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import {
  getAllEvents,
  getMetrics,
  ChronosEventType,
  type ChronosMetrics,
} from '../maintenance/ChronosMonitor';

const logger = new Logger({ level: LogLevel.INFO });

export interface CronExecutionSummary {
  periodStart: number;
  periodEnd: number;
  totalExecutions: number;
  successCount: number;
  failureCount: number;
  missedCount: number;
  successRate: number;
  averageDurationMs: number;
  p50DurationMs: number;
  p90DurationMs: number;
  p99DurationMs: number;
  byTask: Record<string, TaskExecutionStats>;
  byHour: number[];
}

export interface TaskExecutionStats {
  taskId: string;
  totalExecutions: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  averageDurationMs: number;
  lastExecutedAt: number;
  lastStatus: string;
}

export interface CronReport {
  generatedAt: number;
  metrics: ChronosMetrics;
  summary: CronExecutionSummary;
  recentEvents: number;
  recommendations: string[];
}

export class CronReportGenerator {
  generateReport(periodMs: number = 86400000): CronReport {
    const now = Date.now();
    const periodStart = now - periodMs;
    const events = getAllEvents();
    const recentEvents = events.filter(
      (e) => (e.timestamp ?? 0) >= periodStart
    );

    const executedEvents = recentEvents.filter(
      (e) => e.type === ChronosEventType.TASK_EXECUTED
    );
    const failedEvents = recentEvents.filter(
      (e) => e.type === ChronosEventType.TASK_FAILED
    );
    const missedEvents = recentEvents.filter(
      (e) => e.type === ChronosEventType.TASK_MISSED
    );

    const successCount = executedEvents.length;
    const failureCount = failedEvents.length;
    const missedCount = missedEvents.length;
    const totalExecutions = successCount + failureCount;

    const successRate =
      totalExecutions > 0 ? (successCount / totalExecutions) * 100 : 100;

    const byHour: number[] = new Array(24).fill(0);
    for (const e of executedEvents) {
      const hour = new Date(e.timestamp ?? now).getHours();
      byHour[hour]++;
    }

    const taskMap = new Map<string, TaskExecutionStats>();
    for (const e of executedEvents) {
      if (!e.taskId) continue;
      const existing = taskMap.get(e.taskId) || {
        taskId: e.taskId,
        totalExecutions: 0,
        successCount: 0,
        failureCount: 0,
        successRate: 0,
        averageDurationMs: 0,
        lastExecutedAt: 0,
        lastStatus: 'success',
      };
      existing.totalExecutions++;
      existing.successCount++;
      existing.lastExecutedAt = e.timestamp ?? now;
      taskMap.set(e.taskId, existing);
    }
    for (const e of failedEvents) {
      if (!e.taskId) continue;
      const existing = taskMap.get(e.taskId) || {
        taskId: e.taskId,
        totalExecutions: 0,
        successCount: 0,
        failureCount: 0,
        successRate: 0,
        averageDurationMs: 0,
        lastExecutedAt: 0,
        lastStatus: 'success',
      };
      existing.totalExecutions++;
      existing.failureCount++;
      existing.lastExecutedAt = e.timestamp ?? now;
      existing.lastStatus = 'failed';
      taskMap.set(e.taskId, existing);
    }
    for (const [, stats] of taskMap) {
      stats.successRate =
        stats.totalExecutions > 0
          ? (stats.successCount / stats.totalExecutions) * 100
          : 0;
    }

    const recommendations: string[] = [];
    if (failureCount > 0) {
      recommendations.push(`检测到 ${failureCount} 次执行失败，请检查失败任务`);
    }
    if (missedCount > 0) {
      recommendations.push(
        `检测到 ${missedCount} 次执行丢失，建议检查调度器状态`
      );
    }
    if (successRate < 80) {
      recommendations.push(
        `成功率偏低 (${successRate.toFixed(1)}%)，建议排查执行环境`
      );
    }

    return {
      generatedAt: now,
      metrics: getMetrics(),
      summary: {
        periodStart,
        periodEnd: now,
        totalExecutions,
        successCount,
        failureCount,
        missedCount,
        successRate,
        averageDurationMs: 0,
        p50DurationMs: 0,
        p90DurationMs: 0,
        p99DurationMs: 0,
        byTask: Object.fromEntries(taskMap),
        byHour,
      },
      recentEvents: recentEvents.length,
      recommendations,
    };
  }

  toText(report: CronReport): string {
    const lines: string[] = [];
    lines.push('===== Cron 执行报告 =====');
    lines.push(`生成时间: ${new Date(report.generatedAt).toISOString()}`);
    lines.push(
      `统计周期: ${report.summary.periodEnd - report.summary.periodStart}ms`
    );
    lines.push('');
    lines.push(`总任务数: ${report.metrics.totalTasks}`);
    lines.push(`活跃任务: ${report.metrics.activeTasks}`);
    lines.push(`总执行次数: ${report.metrics.totalExecutions}`);
    lines.push('');
    lines.push(`执行成功: ${report.summary.successCount}`);
    lines.push(`执行失败: ${report.summary.failureCount}`);
    lines.push(`执行丢失: ${report.summary.missedCount}`);
    lines.push(`成功率: ${report.summary.successRate.toFixed(1)}%`);
    lines.push('');
    if (report.recommendations.length > 0) {
      lines.push('建议:');
      for (const r of report.recommendations) {
        lines.push(`  - ${r}`);
      }
    }
    return lines.join('\n');
  }
}

export const cronReportGenerator = new CronReportGenerator();
