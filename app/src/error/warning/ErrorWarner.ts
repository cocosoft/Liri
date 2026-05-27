import { AppError, ErrorCategory, ErrorSeverity } from '../types';
import { SafeLogger } from '../safeLog';

export type AlertLevel = 'info' | 'warning' | 'critical';

export interface AlertThreshold {
  name: string;
  type: 'count' | 'rate' | 'consecutive';
  category?: ErrorCategory;
  severity?: ErrorSeverity;
  code?: string;
  window: number;
  value: number;
  level: AlertLevel;
}

export interface AlertEvent {
  id: string;
  threshold: string;
  level: AlertLevel;
  message: string;
  timestamp: number;
  triggeredBy: AppError[];
  acknowledged: boolean;
  acknowledgedAt?: number;
  acknowledgedBy?: string;
}

export interface EscalationPolicy {
  levels: Array<{
    name: string;
    notifyAfter: number;
    channels: string[];
  }>;
}

export interface NotificationChannel {
  name: string;
  send: (alert: AlertEvent) => Promise<void>;
}

export class ErrorWarner {
  private thresholds: AlertThreshold[] = [];
  private events: AlertEvent[] = [];
  private errorHistory: Array<{ error: AppError; timestamp: number }> = [];
  private maxHistory: number = 10000;
  private escalationPolicy: EscalationPolicy = {
    levels: [
      { name: 'level1', notifyAfter: 0, channels: ['console'] },
      { name: 'level2', notifyAfter: 300000, channels: ['console', 'log'] },
      { name: 'level3', notifyAfter: 3600000, channels: ['console', 'log'] },
    ],
  };
  private channels: Map<string, NotificationChannel> = new Map();

  constructor() {
    this.channels.set('console', {
      name: 'console',
      send: async (alert) => {
        SafeLogger.logInfo(`[Alert][${alert.level}] ${alert.message}`, {
          alertId: alert.id,
          threshold: alert.threshold,
        });
      },
    });
  }

  addThreshold(threshold: AlertThreshold): void {
    this.thresholds.push(threshold);
  }

  removeThreshold(name: string): void {
    this.thresholds = this.thresholds.filter((t) => t.name !== name);
  }

  registerChannel(channel: NotificationChannel): void {
    this.channels.set(channel.name, channel);
  }

  unregisterChannel(name: string): void {
    this.channels.delete(name);
  }

  setEscalationPolicy(policy: EscalationPolicy): void {
    this.escalationPolicy = policy;
  }

  evaluate(error: AppError): AlertEvent | null {
    this.errorHistory.push({ error, timestamp: Date.now() });
    if (this.errorHistory.length > this.maxHistory) {
      this.errorHistory = this.errorHistory.slice(-this.maxHistory);
    }

    for (const threshold of this.thresholds) {
      if (!this.matchesFilter(error, threshold)) continue;

      let triggered = false;
      switch (threshold.type) {
        case 'count':
          triggered = this.evaluateCount(threshold);
          break;
        case 'rate':
          triggered = this.evaluateRate(threshold);
          break;
        case 'consecutive':
          triggered = this.evaluateConsecutive(threshold);
          break;
      }

      if (triggered) {
        return this.createAlert(threshold, error);
      }
    }

    return null;
  }

  private matchesFilter(error: AppError, threshold: AlertThreshold): boolean {
    if (threshold.category && error.category !== threshold.category)
      return false;
    if (threshold.severity && error.severity !== threshold.severity)
      return false;
    if (threshold.code && error.code !== threshold.code) return false;
    return true;
  }

  private evaluateCount(threshold: AlertThreshold): boolean {
    const cutoff = Date.now() - threshold.window;
    const matching = this.errorHistory.filter(
      (e) => e.timestamp >= cutoff && this.matchesFilter(e.error, threshold)
    );
    return matching.length >= threshold.value;
  }

  private evaluateRate(threshold: AlertThreshold): boolean {
    const cutoff = Date.now() - threshold.window;
    const matching = this.errorHistory.filter(
      (e) => e.timestamp >= cutoff && this.matchesFilter(e.error, threshold)
    );
    const rate = matching.length / (threshold.window / 1000);
    return rate >= threshold.value;
  }

  private evaluateConsecutive(threshold: AlertThreshold): boolean {
    const recent = this.errorHistory
      .filter((e) => this.matchesFilter(e.error, threshold))
      .slice(-threshold.value);

    if (recent.length < threshold.value) return false;

    for (let i = 1; i < recent.length; i++) {
      const diff = recent[i].timestamp - recent[i - 1].timestamp;
      if (diff > threshold.window) return false;
    }
    return true;
  }

  private createAlert(threshold: AlertThreshold, error: AppError): AlertEvent {
    const alert: AlertEvent = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      threshold: threshold.name,
      level: threshold.level,
      message: `Threshold "${threshold.name}" triggered: ${threshold.type} ${threshold.value} exceeded for ${threshold.category || 'any'} errors`,
      timestamp: Date.now(),
      triggeredBy: this.errorHistory
        .filter((e) => this.matchesFilter(e.error, threshold))
        .slice(-10)
        .map((e) => e.error),
      acknowledged: false,
    };

    this.events.push(alert);
    this.dispatchAlert(alert);
    return alert;
  }

  private async dispatchAlert(alert: AlertEvent): Promise<void> {
    const matchingLevel = this.escalationPolicy.levels.find(
      (l) =>
        l.name ===
        (alert.level === 'critical'
          ? 'level3'
          : alert.level === 'warning'
            ? 'level2'
            : 'level1')
    );
    if (!matchingLevel) return;

    for (const channelName of matchingLevel.channels) {
      const channel = this.channels.get(channelName);
      if (channel) {
        try {
          await channel.send(alert);
        } catch (e) {
          SafeLogger.logError(e as Error, {
            alertId: alert.id,
            channel: channelName,
          });
        }
      }
    }
  }

  acknowledgeAlert(id: string, by?: string): boolean {
    const alert = this.events.find((a) => a.id === id);
    if (!alert || alert.acknowledged) return false;
    alert.acknowledged = true;
    alert.acknowledgedAt = Date.now();
    alert.acknowledgedBy = by;
    return true;
  }

  getAlerts(filter?: {
    level?: AlertLevel;
    acknowledged?: boolean;
  }): AlertEvent[] {
    let result = [...this.events];
    if (filter?.level) {
      result = result.filter((a) => a.level === filter.level);
    }
    if (filter?.acknowledged !== undefined) {
      result = result.filter((a) => a.acknowledged === filter.acknowledged);
    }
    return result.sort((a, b) => b.timestamp - a.timestamp);
  }

  getStats(): {
    totalAlerts: number;
    unacknowledged: number;
    criticalCount: number;
    warningCount: number;
  } {
    const all = this.getAlerts();
    return {
      totalAlerts: all.length,
      unacknowledged: all.filter((a) => !a.acknowledged).length,
      criticalCount: all.filter((a) => a.level === 'critical').length,
      warningCount: all.filter((a) => a.level === 'warning').length,
    };
  }

  clear(): void {
    this.events = [];
    this.errorHistory = [];
  }
}

export const errorWarner = new ErrorWarner();
