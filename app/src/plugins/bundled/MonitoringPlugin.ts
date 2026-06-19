/**
 * MonitoringPlugin
 * 将 monitoring 模块包装为标准 Plugin，通过 PluginAPI 注册监控命令
 */
import type { Plugin, PluginMetadata } from '../types';
import { PluginStatus } from '../types/Plugin.js';
import type { IPluginAPI } from '../api/PluginAPI.js';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import {
  MonitoringService,
  getMonitoringService,
} from '../../monitoring/MonitoringService.js';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * MonitoringPlugin 元数据
 */
export const MonitoringPluginMetadata: PluginMetadata = {
  id: 'monitoring',
  name: 'Monitoring',
  version: '1.0.0',
  description: '监控模块插件，提供系统状态查询和健康检查功能（阶段4推广）',
  author: 'Liri Team',
  category: 'monitoring',
  dependencies: ['core', 'infrastructure'] as any,
  enabledByDefault: true,
};

/**
 * MonitoringPlugin 实现对 monitoring 模块的包装
 * 阶段4推广：验证服务类模块的插件化模式
 */
export class MonitoringPlugin implements Plugin {
  status: PluginStatus = PluginStatus.ENABLED;
  private enabled = true;
  private _api: IPluginAPI | null = null;
  private _monitoringService: MonitoringService | null = null;

  get metadata(): PluginMetadata {
    return MonitoringPluginMetadata;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  setAPI(api: IPluginAPI): void {
    this._api = api;
  }

  getAPI(): IPluginAPI | null {
    return this._api;
  }

  async initialize(): Promise<void> {
    this._monitoringService = getMonitoringService();
    logger.info(`[MonitoringPlugin] 监控服务已获取`);
  }

  async activate(): Promise<void> {
    this.enabled = true;
    logger.info(`[MonitoringPlugin] 已激活`);

    if (this._api && this._monitoringService) {
      this._monitoringService.start();

      this._api.commands.registerCommand('monitoring.status', async () => {
        return this.getSystemStatusText();
      });

      this._api.commands.registerCommand('monitoring.health', async () => {
        return this.getHealthSummary();
      });

      logger.info(
        `[MonitoringPlugin] 已注册 monitoring.status, monitoring.health 命令`
      );
    }
  }

  async deactivate(): Promise<void> {
    this.enabled = false;
    logger.info(`[MonitoringPlugin] 已停用`);
  }

  async dispose(): Promise<void> {
    this._monitoringService = null;
    this._api = null;
    logger.info(`[MonitoringPlugin] 已释放`);
  }

  /**
   * 获取系统状态文本
   */
  getSystemStatusText(): string {
    if (!this._monitoringService) {
      return '监控服务未初始化';
    }
    try {
      const status = this._monitoringService.getSystemStatus();
      const uptimeMin = (status.uptime / 60).toFixed(2);
      const memMb = (status.memory.heapUsed / 1024 / 1024).toFixed(2);
      return `系统状态: 运行 ${uptimeMin} 分钟, 内存 ${memMb} MB`;
    } catch {
      return '获取系统状态失败';
    }
  }

  /**
   * 获取健康检查摘要
   */
  getHealthSummary(): string {
    return '监控模块已通过 PluginAPI 注册（阶段4推广）';
  }
}

/**
 * 创建 MonitoringPlugin 实例
 */
export function createMonitoringPlugin(): MonitoringPlugin {
  return new MonitoringPlugin();
}
