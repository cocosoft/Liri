/**
 * 告警-事件联动桥接器
 * 将 AlertManager 的告警自动关联到 IncidentManager 的事件管理
 */

import {
  AlertManager,
  AlertLevel,
  AlertNotification,
} from '../alerts/AlertManager.js';
import {
  IncidentManager,
  IncidentSeverity,
  IncidentStatus,
} from './IncidentManager.js';

/**
 * 告警-事件桥接器配置
 */
export interface AlertIncidentBridgeConfig {
  enabled: boolean;
  severityMapping: Partial<Record<AlertLevel, IncidentSeverity>>;
  autoResolveOnSilence: boolean;
  deduplicateByRule: boolean;
  defaultTags: string[];
}

const DEFAULT_CONFIG: AlertIncidentBridgeConfig = {
  enabled: true,
  severityMapping: {
    [AlertLevel.CRITICAL]: 'critical',
    [AlertLevel.ERROR]: 'major',
    [AlertLevel.WARNING]: 'warning',
    [AlertLevel.INFO]: 'info',
  },
  autoResolveOnSilence: true,
  deduplicateByRule: true,
  defaultTags: ['alert-driven'],
};

/**
 * 告警事件桥接统计
 */
export interface AlertIncidentBridgeStats {
  totalIncidentsCreated: number;
  totalIncidentsResolved: number;
  activeIncidents: number;
  mappedRuleCount: number;
}

/**
 * 告警-事件桥接器
 * 监听 AlertManager 事件，自动创建和同步 Incident
 */
export class AlertIncidentBridge {
  private alertManager: AlertManager;
  private incidentManager: IncidentManager;
  private config: AlertIncidentBridgeConfig;
  private ruleToIncident: Map<string, string>;
  private running: boolean;
  private boundOnAlert: (notification: AlertNotification) => void;
  private boundOnAlertSilenced: (notification: AlertNotification) => void;

  private stats: AlertIncidentBridgeStats = {
    totalIncidentsCreated: 0,
    totalIncidentsResolved: 0,
    activeIncidents: 0,
    mappedRuleCount: 0,
  };

  constructor(
    alertManager: AlertManager,
    incidentManager: IncidentManager,
    config?: Partial<AlertIncidentBridgeConfig>
  ) {
    this.alertManager = alertManager;
    this.incidentManager = incidentManager;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.ruleToIncident = new Map();
    this.running = false;

    this.boundOnAlert = this.onAlert.bind(this);
    this.boundOnAlertSilenced = this.onAlertSilenced.bind(this);
  }

  /**
   * 启动桥接器，监听 AlertManager 事件
   */
  start(): void {
    if (this.running || !this.config.enabled) {
      return;
    }

    this.alertManager.on('alert', this.boundOnAlert);
    this.alertManager.on('alertSilenced', this.boundOnAlertSilenced);
    this.running = true;
  }

  /**
   * 停止桥接器，移除事件监听
   */
  stop(): void {
    if (!this.running) {
      return;
    }

    this.alertManager.off('alert', this.boundOnAlert);
    this.alertManager.off('alertSilenced', this.boundOnAlertSilenced);
    this.running = false;
  }

  /**
   * 桥接器是否正在运行
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * 获取桥接器配置
   */
  getConfig(): AlertIncidentBridgeConfig {
    return { ...this.config };
  }

  /**
   * 更新桥接器配置
   */
  updateConfig(config: Partial<AlertIncidentBridgeConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取桥接器统计
   */
  getStats(): AlertIncidentBridgeStats {
    return {
      ...this.stats,
      activeIncidents: this.ruleToIncident.size,
      mappedRuleCount: this.ruleToIncident.size,
    };
  }

  /**
   * 获取指定告警规则关联的事件列表
   */
  getIncidentsForRule(
    ruleId: string
  ): import('./IncidentManager.js').Incident[] {
    const incidentId = this.ruleToIncident.get(ruleId);
    if (!incidentId) {
      return [];
    }

    const incident = this.incidentManager.getIncident(incidentId);
    return incident ? [incident] : [];
  }

  /**
   * 处理告警触发事件
   */
  private onAlert(notification: AlertNotification): void {
    if (!this.config.enabled) {
      return;
    }

    const severity = this.mapSeverity(notification.level);

    if (this.config.deduplicateByRule) {
      const existingId = this.ruleToIncident.get(notification.ruleId);
      if (existingId) {
        const existing = this.incidentManager.getIncident(existingId);
        if (
          existing &&
          existing.status !== 'resolved' &&
          existing.status !== 'closed'
        ) {
          this.incidentManager.addRelatedAlert(existingId, notification.id);
          return;
        }
      }
    }

    const incident = this.incidentManager.createIncident({
      title: `告警: ${notification.ruleName}`,
      description: notification.message,
      severity,
      status: 'firing',
      source: 'AlertManager',
      relatedAlertIds: [notification.id],
      tags: [
        ...this.config.defaultTags,
        `rule:${notification.ruleId}`,
        `level:${notification.level}`,
      ],
    });

    this.ruleToIncident.set(notification.ruleId, incident.id);
    this.stats.totalIncidentsCreated++;
  }

  /**
   * 处理告警被静默事件
   */
  private onAlertSilenced(notification: AlertNotification): void {
    if (!this.config.enabled || !this.config.autoResolveOnSilence) {
      return;
    }

    const incidentId = this.ruleToIncident.get(notification.ruleId);
    if (!incidentId) {
      return;
    }

    const incident = this.incidentManager.getIncident(incidentId);
    if (
      !incident ||
      incident.status === 'resolved' ||
      incident.status === 'closed'
    ) {
      return;
    }

    this.incidentManager.addRelatedAlert(incidentId, notification.id);
    this.incidentManager.updateStatus(incidentId, 'resolved', {
      resolution: '告警已被静默规则抑制',
    });

    this.stats.totalIncidentsResolved++;
  }

  /**
   * 将 AlertLevel 映射为 IncidentSeverity
   */
  private mapSeverity(level: AlertLevel): IncidentSeverity {
    return this.config.severityMapping[level] || 'warning';
  }
}
