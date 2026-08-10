/**
 * Bridge-Channel 结果上报器
 *
 * 职责：Bridge 任务执行完成时，通过 Channel 向用户推送结果。
 * 依赖 ChannelBridgeAdapter 的消息格式约定，但可以独立使用。
 *
 * 这是 Bridge → Channel 方向的单向通信：
 *   Bridge Worker 执行 → 结果聚合 → BridgeChannelReporter → Channel → 用户
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { channelRegistry } from '@modules/channels/registry/ChannelRegistry';
import type { ChannelId } from '@modules/channels/types';

const logger = getLogger('bridge:channel:bridgeChannelReporter');

export type TaskReportStatus =
  | 'submitted'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timed_out'
  | 'cancelled';

export interface BridgeTaskReport {
  taskId: string;
  status: TaskReportStatus;
  description: string;
  result?: string;
  error?: string;
  durationMs?: number;
  channelId: ChannelId;
  targetUserId: string;
}

export interface ReporterConfig {
  /** 结果截断长度 */
  maxResultLength: number;
  /** 失败结果是否也推送 */
  reportFailures: boolean;
}

const DEFAULT_REPORTER_CONFIG: ReporterConfig = {
  maxResultLength: 2000,
  reportFailures: true,
};

/**
 * Bridge → Channel 结果上报器
 */
export class BridgeChannelReporter {
  private config: ReporterConfig;

  constructor(config: Partial<ReporterConfig> = {}) {
    this.config = { ...DEFAULT_REPORTER_CONFIG, ...config };
  }

  /**
   * 上报单个任务结果到 Channel
   */
  async reportTask(report: BridgeTaskReport): Promise<boolean> {
    const entry = channelRegistry.get(report.channelId);
    if (!entry || !entry.connected) {
      logger.warning(`结果上报失败: 通道 ${report.channelId} 未注册或未连接`);
      return false;
    }

    if (report.status === 'failed' && !this.config.reportFailures) {
      logger.debug(`已跳过失败任务上报: ${report.taskId}`);
      return true;
    }

    const message = this.renderReport(report);
    try {
      const sendResult = await entry.plugin!.outbound.sendText(
        report.targetUserId,
        message
      );
      if (sendResult) {
        logger.info(
          `Bridge→Channel 上报成功: ${report.taskId} → ${report.channelId}/${report.targetUserId}`
        );
      }
      return sendResult;
    } catch (error) {
      void handleError(error as Error, {
        module: 'bridge:reporter',
        action: 'reportTask',
      });
      logger.error(`Bridge→Channel 上报失败: ${report.taskId}`, error as Error);
      return false;
    }
  }

  /**
   * 批量上报
   */
  async reportBatch(
    reports: BridgeTaskReport[]
  ): Promise<{ success: number; failed: number }> {
    let success = 0;
    let failed = 0;
    for (const report of reports) {
      const ok = await this.reportTask(report);
      if (ok) success++;
      else failed++;
    }
    return { success, failed };
  }

  /**
   * 上报摘要（多个任务汇总为一条消息）
   */
  async reportSummary(
    channelId: ChannelId,
    targetUserId: string,
    reports: BridgeTaskReport[]
  ): Promise<boolean> {
    const entry = channelRegistry.get(channelId);
    if (!entry || !entry.connected) return false;

    const completed = reports.filter((r) => r.status === 'completed');
    const failed = reports.filter(
      (r) => r.status === 'failed' || r.status === 'timed_out'
    );
    const running = reports.filter((r) => r.status === 'running');

    const lines: string[] = [
      `📊 Bridge 任务汇总 (${reports.length} 个)`,
      `  ✅ 成功: ${completed.length}`,
      `  ❌ 失败: ${failed.length}`,
      `  🔄 运行中: ${running.length}`,
    ];

    if (completed.length > 0) {
      lines.push('');
      lines.push('── 已完成 ──');
      for (const r of completed) {
        const dur = r.durationMs
          ? ` (${(r.durationMs / 1000).toFixed(1)}s)`
          : '';
        lines.push(`  ✅ ${r.description}${dur}`);
      }
    }

    if (failed.length > 0) {
      lines.push('');
      lines.push('── 失败 ──');
      for (const r of failed) {
        lines.push(`  ❌ ${r.description}: ${r.error || '未知错误'}`);
      }
    }

    try {
      return await entry.plugin!.outbound.sendText(
        targetUserId,
        lines.join('\n')
      );
    } catch (error) {
      void handleError(error as Error, {
        module: 'bridge:reporter',
        action: 'reportSummary',
      });
      logger.error('摘要上报失败', error as Error);
      return false;
    }
  }

  private renderReport(report: BridgeTaskReport): string {
    const dur = report.durationMs
      ? ` (${(report.durationMs / 1000).toFixed(1)}s)`
      : '';

    switch (report.status) {
      case 'submitted':
        return `📋 任务已提交: ${report.description}\nID: ${report.taskId.slice(-8)}`;
      case 'running':
        return `🔄 任务执行中: ${report.description}${dur}`;
      case 'completed': {
        const result = this.truncate(report.result || '无输出');
        return `✅ 任务完成: ${report.description}${dur}\n\n${result}`;
      }
      case 'failed':
        return `❌ 任务失败: ${report.description}${dur}\n错误: ${report.error || '未知错误'}`;
      case 'timed_out':
        return `⏰ 任务超时: ${report.description}${dur}`;
      case 'cancelled':
        return `🚫 任务已取消: ${report.description}`;
      default:
        return `📌 任务 ${report.status}: ${report.description}`;
    }
  }

  private truncate(text: string): string {
    if (text.length <= this.config.maxResultLength) return text;
    return text.slice(0, this.config.maxResultLength) + '\n...[结果已截断]';
  }
}
