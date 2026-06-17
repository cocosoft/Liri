import { EventEmitter } from 'node:events';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import type { GatewayChannel, ChannelStats } from './types';
import { ChannelStatus, ChannelType } from './types';
import {
  channelEventBus,
  ChannelEvents,
} from '../../channels/events/ChannelEventBus.js';

const logger = new Logger({
  level: LogLevel.INFO,
  module: 'channel:status_reporter',
});

export interface ChannelSnapshot {
  name: string;
  type: ChannelType;
  status: ChannelStatus;
  connected: boolean;
  stats: ChannelStats;
  diagnostics: Record<string, unknown>;
  healthy: boolean;
  lastUpdated: number;
}

export interface StatusReport {
  timestamp: number;
  isRunning: boolean;
  totalChannels: number;
  connectedChannels: number;
  disconnectedChannels: number;
  unhealthyChannels: number;
  idleCount: number;
  channels: ChannelSnapshot[];
  summary: {
    totalMessagesReceived: number;
    totalMessagesSent: number;
    totalErrors: number;
    totalReconnects: number;
    averageUptime: number;
  };
}

export enum ReporterEvent {
  REPORT_GENERATED = 'reporter:report_generated',
  STATUS_CHANGED = 'reporter:status_changed',
}

/**
 * 通道状态上报器
 *
 * @deprecated 请使用 @modules/core/events/EventBus 的 EventBusImpl 替代 Node.js EventEmitter。
 *   此类继承自 Node.js EventEmitter，属于事件孤岛。
 *   新代码应使用 EventBusImpl 替代。
 */
export class ChannelStatusReporter extends EventEmitter {
  readonly name = 'ChannelStatusReporter';
  private channels: Map<string, GatewayChannel> = new Map();
  private previousSnapshots: Map<string, ChannelSnapshot> = new Map();
  private isRunning = false;
  private reportTimer: ReturnType<typeof setInterval> | null = null;
  private autoReportIntervalMs: number;

  constructor(autoReportIntervalMs: number = 0) {
    super();
    this.autoReportIntervalMs = autoReportIntervalMs;
  }

  registerChannel(channel: GatewayChannel): void {
    this.channels.set(channel.name, channel);
    const snapshot = this.createSnapshot(channel);
    this.previousSnapshots.set(channel.name, snapshot);
    logger.info(`ChannelStatusReporter: 通道已注册 — ${channel.name}`);
  }

  unregisterChannel(name: string): void {
    this.channels.delete(name);
    this.previousSnapshots.delete(name);
    logger.info(`ChannelStatusReporter: 通道已注销 — ${name}`);
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    if (this.autoReportIntervalMs > 0) {
      this.reportTimer = setInterval(() => {
        this.generateReport();
      }, this.autoReportIntervalMs);
      logger.info(
        `ChannelStatusReporter: 已启动 (自动报告间隔 ${this.autoReportIntervalMs}ms)`
      );
    } else {
      logger.info('ChannelStatusReporter: 已启动 (手动模式)');
    }
  }

  stop(): void {
    this.isRunning = false;
    if (this.reportTimer) {
      clearInterval(this.reportTimer);
      this.reportTimer = null;
    }
    logger.info('ChannelStatusReporter: 已停止');
  }

  generateReport(isManagerRunning: boolean = true): StatusReport {
    const snapshots: ChannelSnapshot[] = [];

    for (const [, channel] of this.channels) {
      const snapshot = this.createSnapshot(channel);
      snapshots.push(snapshot);
    }

    const connectedCount = snapshots.filter((s) => s.connected).length;
    const disconnectedCount = snapshots.filter(
      (s) =>
        s.status === ChannelStatus.DISCONNECTED ||
        s.status === ChannelStatus.STOPPED
    ).length;
    const unhealthyCount = snapshots.filter(
      (s) => s.status === ChannelStatus.ERROR
    ).length;

    const totalMessagesReceived = snapshots.reduce(
      (sum, s) => sum + s.stats.messagesReceived,
      0
    );
    const totalMessagesSent = snapshots.reduce(
      (sum, s) => sum + s.stats.messagesSent,
      0
    );
    const totalErrors = snapshots.reduce((sum, s) => sum + s.stats.errors, 0);
    const totalReconnects = snapshots.reduce(
      (sum, s) => sum + s.stats.reconnects,
      0
    );
    const connectedSnapshots = snapshots.filter((s) => s.connected);
    const averageUptime =
      connectedSnapshots.length > 0
        ? connectedSnapshots.reduce((sum, s) => sum + s.stats.uptimeMs, 0) /
          connectedSnapshots.length
        : 0;

    const report: StatusReport = {
      timestamp: Date.now(),
      isRunning: isManagerRunning,
      totalChannels: snapshots.length,
      connectedChannels: connectedCount,
      disconnectedChannels: disconnectedCount,
      unhealthyChannels: unhealthyCount,
      idleCount: 0,
      channels: snapshots,
      summary: {
        totalMessagesReceived,
        totalMessagesSent,
        totalErrors,
        totalReconnects,
        averageUptime,
      },
    };

    this.emit(ReporterEvent.REPORT_GENERATED, report);
    channelEventBus.publish(ChannelEvents.REPORT_GENERATED, report);
    return report;
  }

  getChannelSnapshot(name: string): ChannelSnapshot | null {
    const channel = this.channels.get(name);
    if (!channel) return null;
    return this.updateSnapshot(channel);
  }

  getChannelsByStatus(status: ChannelStatus): ChannelSnapshot[] {
    const snapshots: ChannelSnapshot[] = [];
    for (const [, channel] of this.channels) {
      if (channel.status === status) {
        snapshots.push(this.updateSnapshot(channel));
      }
    }
    return snapshots;
  }

  getChannelsByType(type: ChannelType): ChannelSnapshot[] {
    const snapshots: ChannelSnapshot[] = [];
    for (const [, channel] of this.channels) {
      if (channel.type === type) {
        snapshots.push(this.updateSnapshot(channel));
      }
    }
    return snapshots;
  }

  detectChanges(): Array<{
    name: string;
    previous: ChannelSnapshot;
    current: ChannelSnapshot;
    changes: string[];
  }> {
    const changes: Array<{
      name: string;
      previous: ChannelSnapshot;
      current: ChannelSnapshot;
      changes: string[];
    }> = [];

    for (const [, channel] of this.channels) {
      const previous = this.previousSnapshots.get(channel.name);
      if (!previous) continue;

      const current = this.createSnapshot(channel);
      const channelChanges: string[] = [];

      if (previous.status !== current.status) {
        channelChanges.push(`状态: ${previous.status} -> ${current.status}`);
      }
      if (previous.connected !== current.connected) {
        channelChanges.push(
          `连接: ${previous.connected} -> ${current.connected}`
        );
      }
      if (previous.healthy !== current.healthy) {
        channelChanges.push(`健康: ${previous.healthy} -> ${current.healthy}`);
      }
      if (current.stats.errors > previous.stats.errors) {
        channelChanges.push(
          `新错误: ${current.stats.errors - previous.stats.errors} 个`
        );
      }
      if (current.stats.reconnects > previous.stats.reconnects) {
        channelChanges.push(
          `新重连: ${current.stats.reconnects - previous.stats.reconnects} 次`
        );
      }

      if (channelChanges.length > 0) {
        changes.push({
          name: channel.name,
          previous,
          current,
          changes: channelChanges,
        });
      }

      this.previousSnapshots.set(channel.name, current);
    }

    return changes;
  }

  generateSummary(): string {
    const report = this.generateReport();
    const lines: string[] = [
      `通道状态报告 (${new Date(report.timestamp).toISOString()})`,
      `  运行中: ${report.isRunning ? '是' : '否'}`,
      `  总通道: ${report.totalChannels}`,
      `  已连接: ${report.connectedChannels}`,
      `  已断开: ${report.disconnectedChannels}`,
      `  不健康: ${report.unhealthyChannels}`,
      `  消息接收: ${report.summary.totalMessagesReceived}`,
      `  消息发送: ${report.summary.totalMessagesSent}`,
      `  总错误: ${report.summary.totalErrors}`,
      `  总重连: ${report.summary.totalReconnects}`,
    ];

    for (const channel of report.channels) {
      lines.push(
        `  [${channel.type}] ${channel.name}: ${channel.status} ${channel.healthy ? '✓' : '✗'} (延迟: ${channel.stats.uptimeMs}ms)`
      );
    }

    return lines.join('\n');
  }

  private createSnapshot(channel: GatewayChannel): ChannelSnapshot {
    return {
      name: channel.name,
      type: channel.type,
      status: channel.status,
      connected: channel.isConnected(),
      stats: { ...channel.stats },
      diagnostics:
        typeof channel.getDiagnostics === 'function'
          ? { ...channel.getDiagnostics() }
          : {},
      healthy: channel.isConnected(),
      lastUpdated: Date.now(),
    };
  }

  private updateSnapshot(channel: GatewayChannel): ChannelSnapshot {
    const snapshot = this.createSnapshot(channel);
    this.previousSnapshots.set(channel.name, snapshot);
    return snapshot;
  }
}
