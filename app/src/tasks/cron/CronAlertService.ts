/**
 * Cron 失败告警服务
 * 对标 openclaw src/cron/types.ts CronFailureAlert
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import type { CronJob } from './types';

const logger = new Logger({ level: LogLevel.INFO });

export interface CronAlertConfig {
  /** 连续失败多少次后触发告警（默认 2） */
  after: number;
  /** 告警冷却时间（毫秒，默认 1 小时） */
  cooldownMs: number;
  /** 是否将 skipped 计入连续计数 */
  includeSkipped: boolean;
}

const DEFAULT_CONFIG: CronAlertConfig = {
  after: 2,
  cooldownMs: 60 * 60_000,
  includeSkipped: false,
};

/**
 * 告警回调类型：由外部注入，实现具体的通知发送逻辑
 * (如调用 NotificationService、日志、Webhook 等)
 */
export type AlertCallback = (
  job: CronJob,
  reason: string,
  errorCount: number
) => void;

export class CronAlertService {
  private config: CronAlertConfig;
  private lastAlertAt = new Map<string, number>(); // jobId → last alert timestamp
  private onAlert: AlertCallback;

  constructor(onAlert: AlertCallback, config?: Partial<CronAlertConfig>) {
    this.onAlert = onAlert;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 检查作业是否需要告警
   * @param job 作业
   * @param consecutiveErrors 当前连续错误数
   * @param consecutiveSkipped 当前连续跳过数
   */
  check(
    job: CronJob,
    consecutiveErrors: number,
    consecutiveSkipped: number
  ): void {
    const totalFailures =
      consecutiveErrors + (this.config.includeSkipped ? consecutiveSkipped : 0);

    if (totalFailures < this.config.after) return;

    const now = Date.now();
    const lastAlert = this.lastAlertAt.get(job.id);

    // 冷却期内不重复告警
    if (lastAlert && now - lastAlert < this.config.cooldownMs) return;

    this.lastAlertAt.set(job.id, now);

    const reason = `连续失败 ${totalFailures} 次${consecutiveSkipped > 0 ? ` (含 ${consecutiveSkipped} 次跳过)` : ''}`;

    try {
      this.onAlert(job, reason, totalFailures);
      logger.info('[CronAlertService] 已发送失败告警', {
        jobId: job.id,
        name: job.name,
        reason,
      });
    } catch (err) {
      logger.error('[CronAlertService] 告警回调失败', {
        jobId: job.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** 重置指定作业的告警冷却 */
  resetCooldown(jobId: string): void {
    this.lastAlertAt.delete(jobId);
  }
}
