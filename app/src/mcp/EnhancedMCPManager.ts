import { MCPManager } from './managers/MCPManager.js';
import {
  MCPServerManager,
  getMCPServerManager,
} from '../services/mcp/MCPServerManager.js';
import { MCPServerConfig, MCPToolDefinition } from './types';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'mcp:enhancedMCPManager',
  level: LogLevel.INFO,
});

export interface MCPPerformanceMetrics {
  serverName: string;
  averageResponseTime: number;
  requestSuccessRate: number;
  toolExecutionCount: number;
  errorRate: number;
  lastUpdated: Date;
  healthScore: number;
}

export interface MCPServerHealthCheck {
  serverName: string;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'offline';
  lastCheckTime: Date;
  responseTime: number;
  errorMessage?: string;
  recommendations: string[];
}

export interface MCPConnectionAnalytics {
  serverName: string;
  totalConnections: number;
  failedConnections: number;
  averageConnectionTime: number;
  reconnectionCount: number;
  uptimePercentage: number;
  connectionTrend: 'improving' | 'stable' | 'degrading';
}

export interface MCPToolUsageAnalytics {
  toolName: string;
  serverName: string;
  invocationCount: number;
  averageExecutionTime: number;
  successRate: number;
  lastInvoked: Date;
  errorCount: number;
  popularityScore: number;
}

export interface MCPResourceAnalytics {
  serverName: string;
  totalResources: number;
  cachedResources: number;
  cacheHitRate: number;
  averageReadTime: number;
  averageWriteTime: number;
  resourceTypes: Record<string, number>;
}

export interface MCPOptimizationRecommendation {
  id: string;
  type:
    | 'performance'
    | 'reliability'
    | 'security'
    | 'configuration'
    | 'resource';
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  serverName: string;
  expectedImpact: 'minor' | 'moderate' | 'major';
  implementationSteps: string[];
}

export interface MCPSystemReport {
  totalServers: number;
  activeServers: number;
  degradedServers: number;
  offlineServers: number;
  overallHealthScore: number;
  totalTools: number;
  totalRequests: number;
  averageResponseTime: number;
  systemUptime: number;
  generatedAt: Date;
}

export interface EnhancedMCPManagerConfig {
  enableHealthChecks: boolean;
  enablePerformanceMonitoring: boolean;
  enableConnectionAnalytics: boolean;
  enableToolAnalytics: boolean;
  enableResourceAnalytics: boolean;
  healthCheckInterval: number;
  performanceCollectionInterval: number;
  analyticsCollectionInterval: number;
  maxCachedMetrics: number;
}

export class EnhancedMCPManager {
  private baseManager: MCPManager;
  private config: EnhancedMCPManagerConfig;
  private performanceMetrics: Map<string, MCPPerformanceMetrics> = new Map();
  private healthChecks: Map<string, MCPServerHealthCheck[]> = new Map();
  private connectionAnalytics: Map<string, MCPConnectionAnalytics> = new Map();
  private toolUsage: Map<string, MCPToolUsageAnalytics> = new Map();
  private resourceAnalytics: Map<string, MCPResourceAnalytics> = new Map();
  private recommendations: Map<string, MCPOptimizationRecommendation[]> =
    new Map();
  private monitoringIntervals: Map<string, NodeJS.Timeout> = new Map();
  private metricsHistory: Map<string, MCPPerformanceMetrics[]> = new Map();

  constructor(
    baseManager: MCPManager,
    config?: Partial<EnhancedMCPManagerConfig>
  ) {
    this.baseManager = baseManager;
    this.config = {
      enableHealthChecks: true,
      enablePerformanceMonitoring: true,
      enableConnectionAnalytics: true,
      enableToolAnalytics: true,
      enableResourceAnalytics: true,
      healthCheckInterval: 30000,
      performanceCollectionInterval: 60000,
      analyticsCollectionInterval: 300000,
      maxCachedMetrics: 500,
      ...config,
    };

    this.setupMonitoring();
  }

  private setupMonitoring(): void {
    if (this.config.enableHealthChecks) {
      this.startHealthCheckLoop();
    }
    if (this.config.enablePerformanceMonitoring) {
      this.startPerformanceCollectionLoop();
    }
    if (this.config.enableConnectionAnalytics) {
      this.startAnalyticsLoop();
    }
  }

  private startHealthCheckLoop(): void {
    const interval = setInterval(async () => {
      await this.runHealthChecks();
    }, this.config.healthCheckInterval);
    this.monitoringIntervals.set('healthCheck', interval);
  }

  private startPerformanceCollectionLoop(): void {
    const interval = setInterval(async () => {
      await this.collectPerformanceMetrics();
    }, this.config.performanceCollectionInterval);
    this.monitoringIntervals.set('performance', interval);
  }

  private startAnalyticsLoop(): void {
    const interval = setInterval(async () => {
      await this.collectAnalytics();
    }, this.config.analyticsCollectionInterval);
    this.monitoringIntervals.set('analytics', interval);
  }

  async runHealthChecks(): Promise<MCPServerHealthCheck[]> {
    const serverInfos = this.baseManager.getServerInfos();
    const results: MCPServerHealthCheck[] = [];

    for (const info of serverInfos) {
      const healthCheck = await this.checkServerHealth(info.name);
      results.push(healthCheck);

      if (!this.healthChecks.has(info.name)) {
        this.healthChecks.set(info.name, []);
      }
      this.healthChecks.get(info.name)!.push(healthCheck);
    }

    return results;
  }

  private async checkServerHealth(
    serverName: string
  ): Promise<MCPServerHealthCheck> {
    const recommendations: string[] = [];
    let status: MCPServerHealthCheck['status'] = 'healthy';
    let responseTime = 0;
    let errorMessage: string | undefined;

    try {
      const startTime = Date.now();
      const serverStatus = this.baseManager.getServerStatus(serverName);
      responseTime = Date.now() - startTime;

      if (responseTime > 1000) {
        status = 'degraded';
        recommendations.push(
          'Response time is high, consider optimizing connection'
        );
      }

      if (serverStatus === 'NOT_FOUND' || serverStatus === 'ERROR') {
        status = 'unhealthy';
        recommendations.push('Server is not responding, check configuration');
      }
    } catch (error) {
      status = 'unhealthy';
      errorMessage = error instanceof Error ? error.message : String(error);
      recommendations.push('Health check failed: ' + errorMessage);
    }

    return {
      serverName,
      status,
      lastCheckTime: new Date(),
      responseTime,
      errorMessage,
      recommendations,
    };
  }

  private async collectPerformanceMetrics(): Promise<void> {
    const serverInfos = this.baseManager.getServerInfos();

    for (const info of serverInfos) {
      // 从 trackToolUsage 累积的真实数据中构建指标
      const existing = this.performanceMetrics.get(info.name);

      const metrics: MCPPerformanceMetrics = {
        serverName: info.name,
        averageResponseTime: existing?.averageResponseTime ?? 0,
        requestSuccessRate: existing?.requestSuccessRate ?? 0,
        toolExecutionCount: existing?.toolExecutionCount ?? 0,
        errorRate: existing?.errorRate ?? 0,
        lastUpdated: new Date(),
        healthScore: existing?.healthScore ?? 0,
      };

      this.performanceMetrics.set(info.name, metrics);

      if (!this.metricsHistory.has(info.name)) {
        this.metricsHistory.set(info.name, []);
      }
      this.metricsHistory.get(info.name)!.push(metrics);
    }
  }

  private async collectAnalytics(): Promise<void> {
    const serverInfos = this.baseManager.getServerInfos();

    for (const info of serverInfos) {
      const existingConn = this.connectionAnalytics.get(info.name);
      const existingRes = this.resourceAnalytics.get(info.name);

      this.connectionAnalytics.set(info.name, {
        serverName: info.name,
        totalConnections: existingConn?.totalConnections ?? 0,
        failedConnections: existingConn?.failedConnections ?? 0,
        averageConnectionTime: existingConn?.averageConnectionTime ?? 0,
        reconnectionCount: existingConn?.reconnectionCount ?? 0,
        uptimePercentage: existingConn?.uptimePercentage ?? 0,
        connectionTrend: existingConn?.connectionTrend ?? 'stable',
      });

      this.resourceAnalytics.set(info.name, {
        serverName: info.name,
        totalResources: existingRes?.totalResources ?? 0,
        cachedResources: existingRes?.cachedResources ?? 0,
        cacheHitRate: existingRes?.cacheHitRate ?? 0,
        averageReadTime: existingRes?.averageReadTime ?? 0,
        averageWriteTime: existingRes?.averageWriteTime ?? 0,
        resourceTypes: existingRes?.resourceTypes ?? {
          file: 0,
          database: 0,
          api: 0,
          config: 0,
          other: 0,
        },
      });
    }
  }

  async trackToolUsage(
    serverName: string,
    toolName: string,
    executionTime: number,
    success: boolean
  ): Promise<void> {
    const key = `${serverName}:${toolName}`;
    let analytics = this.toolUsage.get(key);

    if (!analytics) {
      analytics = {
        toolName,
        serverName,
        invocationCount: 0,
        averageExecutionTime: 0,
        successRate: 100,
        lastInvoked: new Date(),
        errorCount: 0,
        popularityScore: 0,
      };
    }

    analytics.invocationCount++;
    analytics.averageExecutionTime =
      (analytics.averageExecutionTime * (analytics.invocationCount - 1) +
        executionTime) /
      analytics.invocationCount;
    analytics.lastInvoked = new Date();

    if (!success) {
      analytics.errorCount++;
    }

    analytics.successRate =
      ((analytics.invocationCount - analytics.errorCount) /
        analytics.invocationCount) *
      100;
    analytics.popularityScore = Math.min(100, analytics.invocationCount / 10);

    this.toolUsage.set(key, analytics);
  }

  getServerPerformance(serverName: string): MCPPerformanceMetrics | undefined {
    return this.performanceMetrics.get(serverName);
  }

  getAllPerformanceMetrics(): MCPPerformanceMetrics[] {
    return Array.from(this.performanceMetrics.values());
  }

  getServerHealthHistory(serverName: string): MCPServerHealthCheck[] {
    return this.healthChecks.get(serverName) || [];
  }

  getConnectionAnalytics(
    serverName: string
  ): MCPConnectionAnalytics | undefined {
    return this.connectionAnalytics.get(serverName);
  }

  getToolUsageAnalytics(
    toolName: string,
    serverName?: string
  ): MCPToolUsageAnalytics[] {
    const results: MCPToolUsageAnalytics[] = [];
    for (const analytics of this.toolUsage.values()) {
      if (
        analytics.toolName === toolName &&
        (!serverName || analytics.serverName === serverName)
      ) {
        results.push(analytics);
      }
    }
    return results;
  }

  getAllToolUsageAnalytics(): MCPToolUsageAnalytics[] {
    return Array.from(this.toolUsage.values());
  }

  getResourceAnalytics(serverName: string): MCPResourceAnalytics | undefined {
    return this.resourceAnalytics.get(serverName);
  }

  getRecommendations(serverName: string): MCPOptimizationRecommendation[] {
    return this.recommendations.get(serverName) || [];
  }

  generateRecommendations(serverName: string): MCPOptimizationRecommendation[] {
    const recommendations: MCPOptimizationRecommendation[] = [];
    const performance = this.performanceMetrics.get(serverName);
    const healthHistory = this.healthChecks.get(serverName);
    const connection = this.connectionAnalytics.get(serverName);

    if (performance) {
      if (performance.averageResponseTime > 300) {
        recommendations.push({
          id: `perf-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          type: 'performance',
          title: '优化响应时间',
          description: `服务器 ${serverName} 平均响应时间 ${performance.averageResponseTime.toFixed(0)}ms 较高`,
          priority: 'high',
          serverName,
          expectedImpact: 'major',
          implementationSteps: [
            '分析网络延迟',
            '优化连接池',
            '启用缓存',
            '批量处理请求',
          ],
        });
      }

      if (performance.errorRate > 3) {
        recommendations.push({
          id: `reliability-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          type: 'reliability',
          title: '降低错误率',
          description: `服务器 ${serverName} 错误率 ${performance.errorRate.toFixed(1)}% 偏高`,
          priority: 'medium',
          serverName,
          expectedImpact: 'moderate',
          implementationSteps: [
            '分析错误日志',
            '实现重试机制',
            '添加熔断器',
            '优化错误处理',
          ],
        });
      }
    }

    if (healthHistory && healthHistory.length > 0) {
      const lastHealth = healthHistory[healthHistory.length - 1];
      if (
        lastHealth.status === 'degraded' ||
        lastHealth.status === 'unhealthy'
      ) {
        recommendations.push({
          id: `health-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          type: 'configuration',
          title: '服务器健康检查异常',
          description: `服务器 ${serverName} 健康状态为 ${lastHealth.status}`,
          priority: 'critical',
          serverName,
          expectedImpact: 'major',
          implementationSteps: [
            '检查服务器状态',
            '验证配置',
            '重启服务器',
            '查看错误日志',
          ],
        });
      }
    }

    this.recommendations.set(serverName, recommendations);
    return recommendations;
  }

  getSystemReport(): MCPSystemReport {
    const serverInfos = this.baseManager.getServerInfos();
    const allMetrics = Array.from(this.performanceMetrics.values());
    const allHealth = Array.from(this.healthChecks.values()).flat();

    const activeServers = serverInfos.filter(
      (s) => s.status === 'connected' || s.status === 'ready'
    ).length;
    const degradedServers = allMetrics.filter((m) => m.healthScore < 60).length;
    const offlineServers = serverInfos.filter(
      (s) => s.status === 'disconnected' || s.status === 'NOT_FOUND'
    ).length;

    const overallHealthScore =
      allMetrics.length > 0
        ? allMetrics.reduce((sum, m) => sum + m.healthScore, 0) /
          allMetrics.length
        : 0;

    const averageResponseTime =
      allMetrics.length > 0
        ? allMetrics.reduce((sum, m) => sum + m.averageResponseTime, 0) /
          allMetrics.length
        : 0;

    const totalRequests = allMetrics.reduce(
      (sum, m) => sum + m.toolExecutionCount,
      0
    );

    return {
      totalServers: serverInfos.length,
      activeServers,
      degradedServers,
      offlineServers,
      overallHealthScore: Math.round(overallHealthScore),
      totalTools: Array.from(this.toolUsage.values()).length,
      totalRequests,
      averageResponseTime: Math.round(averageResponseTime),
      systemUptime: process.uptime() * 1000, // 进程运行时间(ms)转为百分比参考
      generatedAt: new Date(),
    };
  }

  getConfig(): EnhancedMCPManagerConfig {
    return { ...this.config };
  }

  updateConfig(newConfig: Partial<EnhancedMCPManagerConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  clearCache(): void {
    this.performanceMetrics.clear();
    this.healthChecks.clear();
    this.connectionAnalytics.clear();
    this.toolUsage.clear();
    this.resourceAnalytics.clear();
    this.recommendations.clear();
    this.metricsHistory.clear();
  }

  destroy(): void {
    this.monitoringIntervals.forEach((interval) => {
      clearInterval(interval);
    });
    this.monitoringIntervals.clear();
    this.clearCache();
  }

  async executeEnhanced(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{
    result: any;
    performanceMetrics?: MCPPerformanceMetrics;
    toolAnalytics?: MCPToolUsageAnalytics;
    recommendations?: MCPOptimizationRecommendation[];
  }> {
    const startTime = Date.now();
    let success = true;
    let result: any;

    try {
      result = await this.baseManager.callTool(serverName, toolName, args);
    } catch (error) {
      success = false;
      result = {
        error: error instanceof Error ? error.message : String(error),
      };
    }

    const executionTime = Date.now() - startTime;

    await this.trackToolUsage(serverName, toolName, executionTime, success);
    await this.collectPerformanceMetrics();

    const performanceMetrics = this.performanceMetrics.get(serverName);
    const toolAnalytics = this.toolUsage.get(`${serverName}:${toolName}`);
    const recommendations = this.generateRecommendations(serverName);

    return {
      result,
      performanceMetrics,
      toolAnalytics,
      recommendations,
    };
  }
}
