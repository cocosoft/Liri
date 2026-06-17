import { PerformanceOptimizer } from './PerformanceOptimizer.js';
import { getProcessCpuPercent } from '../monitoring/metrics/SystemMetricsCollector.js';

export interface EnhancedPerformanceMetrics {
  timestamp: Date;
  cpu: {
    user: number;
    system: number;
    idle: number;
    usagePercentage: number;
  };
  memory: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
    usagePercentage: number;
  };
  eventLoop: {
    latency: number;
    lag: number;
  };
  gc: {
    totalCollections: number;
    totalPause: number;
    averagePause: number;
  };
  custom: Record<string, number>;
}

export interface PerformanceBottleneck {
  id: string;
  type: 'cpu' | 'memory' | 'io' | 'event_loop' | 'gc' | 'custom';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  currentValue: number;
  threshold: number;
  recommendation: string;
  detectedAt: Date;
}

export interface PerformanceTrend {
  metric: string;
  direction: 'improving' | 'stable' | 'degrading';
  changePercent: number;
  confidence: number;
  prediction: number;
  dataPoints: { value: number; timestamp: Date }[];
}

export interface PerformanceOptimizationRecommendation {
  id: string;
  category: 'cpu' | 'memory' | 'cache' | 'io' | 'code' | 'configuration';
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  expectedImprovement: number;
  implementationEffort: 'low' | 'medium' | 'high';
  implementationSteps: string[];
  risks: string[];
}

export interface PerformanceReport {
  id: string;
  generatedAt: Date;
  period: { start: Date; end: Date };
  summary: {
    overallScore: number;
    cpuHealth: number;
    memoryHealth: number;
    eventLoopHealth: number;
    bottlenecksCount: number;
    criticalBottlenecksCount: number;
  };
  bottlenecks: PerformanceBottleneck[];
  trends: PerformanceTrend[];
  recommendations: PerformanceOptimizationRecommendation[];
  metrics: EnhancedPerformanceMetrics[];
}

export interface EnhancedPerformanceManagerConfig {
  enableContinuousMonitoring: boolean;
  enableAutoOptimization: boolean;
  enableBottleneckDetection: boolean;
  enableTrendAnalysis: boolean;
  monitoringInterval: number;
  bottleneckCheckInterval: number;
  trendAnalysisInterval: number;
  metricsHistorySize: number;
  cpuThreshold: number;
  memoryThreshold: number;
  eventLoopThreshold: number;
}

export class EnhancedPerformanceManager {
  private optimizer: PerformanceOptimizer;
  private config: EnhancedPerformanceManagerConfig;
  private metricsHistory: EnhancedPerformanceMetrics[] = [];
  private bottlenecks: PerformanceBottleneck[] = [];
  private trends: Map<string, PerformanceTrend> = new Map();
  private recommendations: PerformanceOptimizationRecommendation[] = [];
  private monitoringIntervals: Map<string, NodeJS.Timeout> = new Map();

  constructor(config?: Partial<EnhancedPerformanceManagerConfig>) {
    this.optimizer = PerformanceOptimizer.getInstance();
    this.config = {
      enableContinuousMonitoring: true,
      enableAutoOptimization: true,
      enableBottleneckDetection: true,
      enableTrendAnalysis: true,
      monitoringInterval: 5000,
      bottleneckCheckInterval: 30000,
      trendAnalysisInterval: 60000,
      metricsHistorySize: 200,
      cpuThreshold: 80,
      memoryThreshold: 85,
      eventLoopThreshold: 50,
      ...config,
    };

    if (this.config.enableContinuousMonitoring) {
      this.startMonitoring();
    }
  }

  private startMonitoring(): void {
    const monitoringInterval = setInterval(() => {
      this.collectMetrics();
    }, this.config.monitoringInterval);
    this.monitoringIntervals.set('monitoring', monitoringInterval);

    if (this.config.enableBottleneckDetection) {
      const bottleneckInterval = setInterval(() => {
        this.detectBottlenecks();
      }, this.config.bottleneckCheckInterval);
      this.monitoringIntervals.set('bottleneck', bottleneckInterval);
    }

    if (this.config.enableTrendAnalysis) {
      const trendInterval = setInterval(() => {
        this.analyzeTrends();
      }, this.config.trendAnalysisInterval);
      this.monitoringIntervals.set('trend', trendInterval);
    }
  }

  collectMetrics(): EnhancedPerformanceMetrics {
    const cpu = process.cpuUsage();
    const mem = process.memoryUsage();
    const cpuUsagePercent = getProcessCpuPercent();

    const metrics: EnhancedPerformanceMetrics = {
      timestamp: new Date(),
      cpu: {
        user: cpu.user,
        system: cpu.system,
        idle: Math.max(0, 100 - cpuUsagePercent),
        usagePercentage: Math.min(100, Math.round(cpuUsagePercent * 10) / 10),
      },
      memory: {
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        external: mem.external,
        rss: mem.rss,
        usagePercentage: (mem.heapUsed / mem.heapTotal) * 100,
      },
      eventLoop: {
        latency: 0,
        lag: 0,
      },
      gc: {
        totalCollections: 0,
        totalPause: 0,
        averagePause: 0,
      },
      custom: {},
    };

    this.metricsHistory.push(metrics);
    if (this.metricsHistory.length > this.config.metricsHistorySize) {
      this.metricsHistory.shift();
    }

    return metrics;
  }

  detectBottlenecks(): PerformanceBottleneck[] {
    const latestMetrics = this.metricsHistory[this.metricsHistory.length - 1];
    if (!latestMetrics) return [];

    const newBottlenecks: PerformanceBottleneck[] = [];

    if (latestMetrics.cpu.usagePercentage > this.config.cpuThreshold) {
      newBottlenecks.push({
        id: `cpu-${Date.now()}`,
        type: 'cpu',
        severity:
          latestMetrics.cpu.usagePercentage > 95
            ? 'critical'
            : latestMetrics.cpu.usagePercentage > 90
              ? 'high'
              : 'medium',
        description: `CPU usage at ${latestMetrics.cpu.usagePercentage.toFixed(1)}%`,
        currentValue: latestMetrics.cpu.usagePercentage,
        threshold: this.config.cpuThreshold,
        recommendation:
          'Consider reducing concurrent operations or optimizing CPU-intensive code',
        detectedAt: new Date(),
      });
    }

    if (latestMetrics.memory.usagePercentage > this.config.memoryThreshold) {
      newBottlenecks.push({
        id: `memory-${Date.now()}`,
        type: 'memory',
        severity:
          latestMetrics.memory.usagePercentage > 95
            ? 'critical'
            : latestMetrics.memory.usagePercentage > 90
              ? 'high'
              : 'medium',
        description: `Memory usage at ${latestMetrics.memory.usagePercentage.toFixed(1)}% (${(latestMetrics.memory.heapUsed / 1024 / 1024).toFixed(1)}MB/${(latestMetrics.memory.heapTotal / 1024 / 1024).toFixed(1)}MB)`,
        currentValue: latestMetrics.memory.usagePercentage,
        threshold: this.config.memoryThreshold,
        recommendation:
          'Consider implementing memory pooling, reducing object allocations, or checking for memory leaks',
        detectedAt: new Date(),
      });
    }

    if (latestMetrics.eventLoop.lag > this.config.eventLoopThreshold) {
      newBottlenecks.push({
        id: `eventloop-${Date.now()}`,
        type: 'event_loop',
        severity:
          latestMetrics.eventLoop.lag > 100
            ? 'critical'
            : latestMetrics.eventLoop.lag > 75
              ? 'high'
              : 'medium',
        description: `Event loop lag at ${latestMetrics.eventLoop.lag.toFixed(1)}ms`,
        currentValue: latestMetrics.eventLoop.lag,
        threshold: this.config.eventLoopThreshold,
        recommendation:
          'Check for blocking operations, reduce synchronous I/O, or break up long-running tasks',
        detectedAt: new Date(),
      });
    }

    this.bottlenecks.push(...newBottlenecks);
    return newBottlenecks;
  }

  analyzeTrends(): PerformanceTrend[] {
    if (this.metricsHistory.length < 10) return [];

    const trends: PerformanceTrend[] = [];
    const recentMetrics = this.metricsHistory.slice(-20);

    const cpuTrend = this.calculateTrend(
      'cpu_usage',
      recentMetrics.map((m) => ({
        value: m.cpu.usagePercentage,
        timestamp: m.timestamp,
      }))
    );
    trends.push(cpuTrend);

    const memoryTrend = this.calculateTrend(
      'memory_usage',
      recentMetrics.map((m) => ({
        value: m.memory.usagePercentage,
        timestamp: m.timestamp,
      }))
    );
    trends.push(memoryTrend);

    const eventLoopTrend = this.calculateTrend(
      'event_loop_lag',
      recentMetrics.map((m) => ({
        value: m.eventLoop.lag,
        timestamp: m.timestamp,
      }))
    );
    trends.push(eventLoopTrend);

    trends.forEach((t) => this.trends.set(t.metric, t));
    return trends;
  }

  private calculateTrend(
    metric: string,
    dataPoints: { value: number; timestamp: Date }[]
  ): PerformanceTrend {
    if (dataPoints.length < 2) {
      return {
        metric,
        direction: 'stable',
        changePercent: 0,
        confidence: 0,
        prediction: dataPoints[0]?.value || 0,
        dataPoints,
      };
    }

    const firstValue = dataPoints[0].value;
    const lastValue = dataPoints[dataPoints.length - 1].value;
    const changePercent =
      firstValue > 0 ? ((lastValue - firstValue) / firstValue) * 100 : 0;

    let direction: 'improving' | 'stable' | 'degrading';
    if (Math.abs(changePercent) < 5) {
      direction = 'stable';
    } else if (changePercent > 0) {
      direction = 'degrading';
    } else {
      direction = 'improving';
    }

    const prediction =
      lastValue + ((lastValue - firstValue) / dataPoints.length) * 5;

    return {
      metric,
      direction,
      changePercent: Math.round(changePercent * 100) / 100,
      confidence: Math.min(0.9, dataPoints.length / 30),
      prediction: Math.round(prediction * 100) / 100,
      dataPoints,
    };
  }

  generateRecommendations(): PerformanceOptimizationRecommendation[] {
    const recommendations: PerformanceOptimizationRecommendation[] = [];

    const criticalBottlenecks = this.bottlenecks.filter(
      (b) => b.severity === 'critical' || b.severity === 'high'
    );
    const latest = this.metricsHistory[this.metricsHistory.length - 1];

    for (const bottleneck of criticalBottlenecks) {
      switch (bottleneck.type) {
        case 'cpu':
          recommendations.push({
            id: `rec-${Date.now()}-cpu`,
            category: 'cpu',
            title: 'CPU优化建议',
            description: bottleneck.description,
            priority: bottleneck.severity as 'high' | 'critical',
            expectedImprovement: 20,
            implementationEffort: 'medium',
            implementationSteps: [
              '分析CPU热点函数',
              '优化关键路径算法',
              '考虑使用Worker线程分担计算',
              '实现请求批处理',
            ],
            risks: ['优化可能影响代码可读性'],
          });
          break;
        case 'memory':
          recommendations.push({
            id: `rec-${Date.now()}-memory`,
            category: 'memory',
            title: '内存优化建议',
            description: bottleneck.description,
            priority: bottleneck.severity as 'high' | 'critical',
            expectedImprovement: 30,
            implementationEffort: 'high',
            implementationSteps: [
              '使用内存分析工具检测泄漏',
              '优化数据结构减少内存占用',
              '实现对象池复用',
              '调整垃圾回收策略',
            ],
            risks: ['对象池可能增加代码复杂度'],
          });
          break;
      }
    }

    if (!criticalBottlenecks.length && latest) {
      recommendations.push({
        id: `rec-${Date.now()}-cache`,
        category: 'cache',
        title: '缓存策略优化',
        description: '当前系统运行良好，建议优化缓存策略以提升性能',
        priority: 'low',
        expectedImprovement: 10,
        implementationEffort: 'low',
        implementationSteps: [
          '审查现有缓存策略',
          '调整缓存TTL值',
          '实现多级缓存',
        ],
        risks: ['缓存不一致风险'],
      });
    }

    this.recommendations = recommendations;
    return recommendations;
  }

  generateReport(): PerformanceReport {
    const now = new Date();
    const start = new Date(now.getTime() - 3600000); // 1小时前

    this.collectMetrics();
    this.detectBottlenecks();
    this.analyzeTrends();
    this.generateRecommendations();

    const allBottlenecks = this.bottlenecks;
    const criticalBottlenecks = allBottlenecks.filter(
      (b) => b.severity === 'critical'
    );

    const cpuHealth = Math.max(
      0,
      100 -
        (this.metricsHistory[this.metricsHistory.length - 1]?.cpu
          .usagePercentage || 0)
    );
    const memoryHealth = Math.max(
      0,
      100 -
        (this.metricsHistory[this.metricsHistory.length - 1]?.memory
          .usagePercentage || 0)
    );
    const eventLoopHealth = Math.max(
      0,
      100 -
        (this.metricsHistory[this.metricsHistory.length - 1]?.eventLoop.lag ||
          0)
    );

    const overallScore = Math.round(
      (cpuHealth + memoryHealth + eventLoopHealth) / 3
    );

    return {
      id: `report-${Date.now()}`,
      generatedAt: now,
      period: { start, end: now },
      summary: {
        overallScore,
        cpuHealth: Math.round(cpuHealth),
        memoryHealth: Math.round(memoryHealth),
        eventLoopHealth: Math.round(eventLoopHealth),
        bottlenecksCount: allBottlenecks.length,
        criticalBottlenecksCount: criticalBottlenecks.length,
      },
      bottlenecks: allBottlenecks.slice(-10),
      trends: Array.from(this.trends.values()),
      recommendations: this.recommendations,
      metrics: this.metricsHistory.slice(-10),
    };
  }

  getMetricsHistory(): EnhancedPerformanceMetrics[] {
    return [...this.metricsHistory];
  }

  getLatestMetrics(): EnhancedPerformanceMetrics | undefined {
    return this.metricsHistory[this.metricsHistory.length - 1];
  }

  getBottlenecks(): PerformanceBottleneck[] {
    return [...this.bottlenecks];
  }

  getTrends(): PerformanceTrend[] {
    return Array.from(this.trends.values());
  }

  getRecommendations(): PerformanceOptimizationRecommendation[] {
    return [...this.recommendations];
  }

  getConfig(): EnhancedPerformanceManagerConfig {
    return { ...this.config };
  }

  updateConfig(newConfig: Partial<EnhancedPerformanceManagerConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  clearHistory(): void {
    this.metricsHistory = [];
    this.bottlenecks = [];
    this.trends.clear();
    this.recommendations = [];
  }

  destroy(): void {
    this.monitoringIntervals.forEach((interval) => {
      clearInterval(interval);
    });
    this.monitoringIntervals.clear();
    this.clearHistory();
  }
}
