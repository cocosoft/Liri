/**
 * 状态插件
 * 提供系统状态监控功能
 */

import type { Plugin, PluginMetadata } from '../types';
import { PluginStatus } from '../types/Plugin.js';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('plugins:bundled:statusPlugin');

export interface SystemStatus {
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  networkStatus: 'online' | 'offline' | 'connecting';
  uptime: number;
  activeConnections: number;
  pluginCount: number;
  skillCount: number;
}

export const StatusPluginMetadata: PluginMetadata = {
  id: 'status',
  name: 'Status',
  version: '1.0.0',
  description: '状态插件，提供系统状态监控功能',
  author: 'Liri Team',
  category: 'core',
  dependencies: [],
  enabledByDefault: true,
};

export class StatusPlugin implements Plugin {
  status: PluginStatus = PluginStatus.ENABLED;
  private enabled = true;
  private startTime = Date.now();

  get metadata(): PluginMetadata {
    return StatusPluginMetadata;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  async initialize(): Promise<void> {
    logger.info(`[StatusPlugin] 初始化状态插件`);
  }

  async activate(): Promise<void> {
    this.enabled = true;
    logger.info(`[StatusPlugin] 状态插件已激活`);
  }

  async deactivate(): Promise<void> {
    this.enabled = false;
    logger.info(`[StatusPlugin] 状态插件已停用`);
  }

  async dispose(): Promise<void> {
    logger.info(`[StatusPlugin] 状态插件已释放`);
  }

  /**
   * 获取系统状态
   */
  getSystemStatus(): SystemStatus {
    return {
      cpuUsage: this.getCPUUsage(),
      memoryUsage: this.getMemoryUsage(),
      diskUsage: this.getDiskUsage(),
      networkStatus: this.getNetworkStatus(),
      uptime: this.getUptime(),
      activeConnections: this.getActiveConnections(),
      pluginCount: this.getPluginCount(),
      skillCount: this.getSkillCount(),
    };
  }

  /**
   * 获取状态摘要
   */
  getStatusSummary(): string {
    const status = this.getSystemStatus();
    return `
系统状态摘要：

运行时间: ${this.formatUptime(status.uptime)}
CPU使用率: ${status.cpuUsage}%
内存使用率: ${status.memoryUsage}%
磁盘使用率: ${status.diskUsage}%
网络状态: ${status.networkStatus}
活跃连接: ${status.activeConnections}
已加载插件: ${status.pluginCount}
已加载技能: ${status.skillCount}
    `.trim();
  }

  private getCPUUsage(): number {
    // 简化实现：返回模拟值
    return Math.floor(Math.random() * 30) + 10;
  }

  private getMemoryUsage(): number {
    // 简化实现：返回模拟值
    return Math.floor(Math.random() * 20) + 40;
  }

  private getDiskUsage(): number {
    // 简化实现：返回模拟值
    return Math.floor(Math.random() * 15) + 50;
  }

  private getNetworkStatus(): 'online' | 'offline' | 'connecting' {
    // 简化实现：返回在线状态
    return 'online';
  }

  private getUptime(): number {
    return Date.now() - this.startTime;
  }

  private getActiveConnections(): number {
    // 简化实现：返回模拟值
    return Math.floor(Math.random() * 5);
  }

  private getPluginCount(): number {
    // 简化实现：返回内置插件数量
    return 4;
  }

  private getSkillCount(): number {
    // 简化实现：返回内置技能数量
    return 20;
  }

  private formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}天 ${hours % 24}小时 ${minutes % 60}分钟`;
    }
    if (hours > 0) {
      return `${hours}小时 ${minutes % 60}分钟`;
    }
    if (minutes > 0) {
      return `${minutes}分钟 ${seconds % 60}秒`;
    }
    return `${seconds}秒`;
  }
}

export function createStatusPlugin(): Plugin {
  return new StatusPlugin();
}
