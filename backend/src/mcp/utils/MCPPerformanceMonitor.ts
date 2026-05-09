/**
 * MCP性能监控工具
 * 提供MCP服务器性能指标收集、统计分析和健康监控
 */

import { MCPServerStatus } from '../types';

export interface MCPServerMetrics {
  serverName: string;
  status: MCPServerStatus;
  uptime: number;
  totalRequests: number;
  successRequests: number;
  failureRequests: number;
  averageLatency: number;
  lastRequestTime: Date | null;
  lastError: string | null;
  toolsAvailable: number;
}

export interface MCPRequestRecord {
  timestamp: Date;
  serverName: string;
  toolName: string;
  latency: number;
  success: boolean;
  error?: string;
}

/**
 * MCP性能监控器
 */
export class MCPPerformanceMonitor {
  private serverMetrics: Map<string, MCPServerMetrics> = new Map();
  private requestRecords: MCPRequestRecord[] = [];
  private connectionEvents: Array<{
    timestamp: Date;
    serverName: string;
    event: string;
  }> = [];
  private static instance: MCPPerformanceMonitor;
  private readonly maxRecords = 10000;

  private constructor() {}

  static getInstance(): MCPPerformanceMonitor {
    if (!MCPPerformanceMonitor.instance) {
      MCPPerformanceMonitor.instance = new MCPPerformanceMonitor();
    }
    return MCPPerformanceMonitor.instance;
  }

  /**
   * 初始化服务器监控
   */
  initializeServer(
    serverName: string,
    initialStatus: MCPServerStatus = MCPServerStatus.DISCONNECTED
  ): void {
    this.serverMetrics.set(serverName, {
      serverName,
      status: initialStatus,
      uptime: 0,
      totalRequests: 0,
      successRequests: 0,
      failureRequests: 0,
      averageLatency: 0,
      lastRequestTime: null,
      lastError: null,
      toolsAvailable: 0,
    });
  }

  /**
   * 更新服务器状态
   */
  updateServerStatus(serverName: string, status: MCPServerStatus): void {
    const metrics = this.serverMetrics.get(serverName);
    if (metrics) {
      const previousStatus = metrics.status;
      metrics.status = status;

      this.connectionEvents.push({
        timestamp: new Date(),
        serverName,
        event: `Status changed from ${previousStatus} to ${status}`,
      });

      if (status === MCPServerStatus.CONNECTED) {
        metrics.uptime = Date.now();
      }
    }
  }

  /**
   * 记录请求
   */
  recordRequest(record: Omit<MCPRequestRecord, 'timestamp'>): void {
    const fullRecord: MCPRequestRecord = {
      ...record,
      timestamp: new Date(),
    };

    this.requestRecords.push(fullRecord);

    if (this.requestRecords.length > this.maxRecords) {
      this.requestRecords.shift();
    }

    const metrics = this.serverMetrics.get(record.serverName);
    if (metrics) {
      metrics.totalRequests++;
      metrics.lastRequestTime = fullRecord.timestamp;

      if (record.success) {
        metrics.successRequests++;
      } else {
        metrics.failureRequests++;
        metrics.lastError = record.error || 'Unknown error';
      }

      const totalLatency = metrics.averageLatency * (metrics.totalRequests - 1);
      metrics.averageLatency =
        (totalLatency + record.latency) / metrics.totalRequests;
    }
  }

  /**
   * 更新可用工具数量
   */
  updateToolsAvailable(serverName: string, count: number): void {
    const metrics = this.serverMetrics.get(serverName);
    if (metrics) {
      metrics.toolsAvailable = count;
    }
  }

  /**
   * 获取服务器指标
   */
  getServerMetrics(serverName: string): MCPServerMetrics | null {
    return this.serverMetrics.get(serverName) || null;
  }

  /**
   * 获取所有服务器指标
   */
  getAllServerMetrics(): MCPServerMetrics[] {
    return Array.from(this.serverMetrics.values());
  }

  /**
   * 获取健康服务器列表
   */
  getHealthyServers(): string[] {
    const healthy: string[] = [];
    for (const [name, metrics] of this.serverMetrics) {
      if (metrics.status === MCPServerStatus.CONNECTED) {
        healthy.push(name);
      }
    }
    return healthy;
  }

  /**
   * 获取请求记录
   */
  getRequestRecords(timeWindowMs?: number, limit?: number): MCPRequestRecord[] {
    let records = this.requestRecords;

    if (timeWindowMs) {
      const cutoffTime = new Date(Date.now() - timeWindowMs);
      records = records.filter((r) => r.timestamp >= cutoffTime);
    }

    if (limit) {
      return records.slice(-limit);
    }

    return records;
  }

  /**
   * 获取连接事件
   */
  getConnectionEvents(
    timeWindowMs?: number
  ): Array<{ timestamp: Date; serverName: string; event: string }> {
    if (timeWindowMs) {
      const cutoffTime = new Date(Date.now() - timeWindowMs);
      return this.connectionEvents.filter((e) => e.timestamp >= cutoffTime);
    }
    return [...this.connectionEvents];
  }

  /**
   * 获取性能统计
   */
  getStats(timeWindowMs?: number): {
    totalRequests: number;
    successRate: number;
    averageLatency: number;
    serversOnline: number;
    serversOffline: number;
  } {
    const records = timeWindowMs
      ? this.getRequestRecords(timeWindowMs)
      : this.requestRecords;
    const servers = this.getAllServerMetrics();

    const totalRequests = records.length;
    const successRequests = records.filter((r) => r.success).length;
    const totalLatency = records.reduce((sum, r) => sum + r.latency, 0);
    const serversOnline = servers.filter(
      (s) => s.status === MCPServerStatus.CONNECTED
    ).length;

    return {
      totalRequests,
      successRate: totalRequests > 0 ? successRequests / totalRequests : 0,
      averageLatency: totalRequests > 0 ? totalLatency / totalRequests : 0,
      serversOnline,
      serversOffline: servers.length - serversOnline,
    };
  }

  /**
   * 获取最慢的请求
   */
  getSlowestRequests(count: number = 10): MCPRequestRecord[] {
    return [...this.requestRecords]
      .sort((a, b) => b.latency - a.latency)
      .slice(0, count);
  }

  /**
   * 获取最常使用的工具
   */
  getMostUsedTools(
    count: number = 10
  ): Array<{ toolName: string; count: number; averageLatency: number }> {
    const toolStats: Record<string, { count: number; totalLatency: number }> =
      {};

    for (const record of this.requestRecords) {
      if (!toolStats[record.toolName]) {
        toolStats[record.toolName] = { count: 0, totalLatency: 0 };
      }
      toolStats[record.toolName].count++;
      toolStats[record.toolName].totalLatency += record.latency;
    }

    return Object.entries(toolStats)
      .map(([toolName, stats]) => ({
        toolName,
        count: stats.count,
        averageLatency: stats.totalLatency / stats.count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, count);
  }

  /**
   * 清空记录
   */
  clear(): void {
    this.requestRecords = [];
    this.connectionEvents = [];
  }

  /**
   * 删除服务器监控
   */
  removeServer(serverName: string): void {
    this.serverMetrics.delete(serverName);
  }

  /**
   * 获取服务器健康报告
   */
  getHealthReport(): {
    healthy: string[];
    degraded: string[];
    unhealthy: string[];
    suggestions: string[];
  } {
    const healthy: string[] = [];
    const degraded: string[] = [];
    const unhealthy: string[] = [];
    const suggestions: string[] = [];

    for (const [name, metrics] of this.serverMetrics) {
      const recentRecords = this.getRequestRecords(300000).filter(
        (r) => r.serverName === name
      );
      const recentFailureRate =
        recentRecords.length > 0
          ? recentRecords.filter((r) => !r.success).length /
            recentRecords.length
          : 0;

      if (metrics.status !== MCPServerStatus.CONNECTED) {
        unhealthy.push(name);
        suggestions.push(`服务器 ${name} 未连接`);
      } else if (recentFailureRate > 0.5) {
        unhealthy.push(name);
        suggestions.push(
          `服务器 ${name} 失败率过高 (${(recentFailureRate * 100).toFixed(1)}%)`
        );
      } else if (recentFailureRate > 0.1) {
        degraded.push(name);
        suggestions.push(
          `服务器 ${name} 失败率偏高 (${(recentFailureRate * 100).toFixed(1)}%)`
        );
      } else {
        healthy.push(name);
      }
    }

    return { healthy, degraded, unhealthy, suggestions };
  }
}
