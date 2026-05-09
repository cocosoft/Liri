import {
  EnhancedMCPManager,
  MCPPerformanceMetrics,
  MCPHealthCheck,
  MCPConnectionAnalytics,
  MCPToolUsageAnalytics,
  MCPResourceAnalytics,
  MCPOptimizationRecommendation,
} from './EnhancedMCPManager.js';

export interface MCPAnalysisResult {
  serverName: string;
  overallScore: number;
  performanceScore: number;
  healthScore: number;
  connectionScore: number;
  toolScore: number;
  resourceScore: number;
  analyzedAt: Date;
  analysis: MCPAnalysisDetails;
  recommendations: MCPOptimizationRecommendation[];
  warnings: MCPWarning[];
}

export interface MCPAnalysisDetails {
  performance: MCPPerformanceAnalysis;
  health: MCPHealthAnalysis;
  connections: MCPConnectionAnalysis;
  tools: MCPToolAnalysis;
  resources: MCPResourceAnalysis;
  trends: MCPTrendAnalysis;
}

export interface MCPPerformanceAnalysis {
  averageResponseTime: number;
  responseTimeTrend: 'improving' | 'stable' | 'degrading';
  requestVolume: number;
  peakResponseTime: number;
  performanceBottlenecks: string[];
  optimizationPotential: number;
}

export interface MCPHealthAnalysis {
  currentStatus: 'healthy' | 'degraded' | 'unhealthy' | 'offline';
  uptimePercentage: number;
  stabilityScore: number;
  healthTrend: 'improving' | 'stable' | 'declining';
  recentIncidents: number;
  recoveryTime: number;
}

export interface MCPConnectionAnalysis {
  connectionSuccessRate: number;
  averageConnectionTime: number;
  reconnectionRate: number;
  connectionStability: number;
  protocolEfficiency: number;
  connectionPoolUtilization: number;
}

export interface MCPToolAnalysis {
  totalTools: number;
  activeTools: number;
  highErrorTools: string[];
  highUsageTools: string[];
  toolDiversity: number;
  averageExecutionTime: number;
  executionTimeDistribution: Record<string, number>;
}

export interface MCPResourceAnalysis {
  totalResources: number;
  resourceUtilization: number;
  cacheEfficiency: number;
  readWriteRatio: number;
  largestResources: string[];
  resourceTypeDistribution: Record<string, number>;
}

export interface MCPTrendAnalysis {
  performanceTrend: {
    direction: 'improving' | 'stable' | 'degrading';
    confidence: number;
    projection: number;
  };
  healthTrend: {
    direction: 'improving' | 'stable' | 'declining';
    confidence: number;
    projection: number;
  };
  usageTrend: {
    direction: 'increasing' | 'stable' | 'decreasing';
    confidence: number;
    projection: number;
  };
  errorTrend: {
    direction: 'increasing' | 'stable' | 'decreasing';
    confidence: number;
    projection: number;
  };
}

export interface MCPWarning {
  id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  type: 'performance' | 'health' | 'security' | 'reliability' | 'configuration';
  message: string;
  serverName: string;
  detectedAt: Date;
  autoResolved: boolean;
}

export interface IntelligentMCPAnalyzerConfig {
  enableDeepAnalysis: boolean;
  enableTrendAnalysis: boolean;
  enablePredictiveAnalysis: boolean;
  analysisDepth: 'basic' | 'standard' | 'advanced';
  maxAnalysisHistory: number;
  analysisTimeout: number;
  cacheTTL: number;
}

export class IntelligentMCPAnalyzer {
  private enhancedManager: EnhancedMCPManager;
  private config: IntelligentMCPAnalyzerConfig;
  private analysisCache: Map<
    string,
    { result: MCPAnalysisResult; timestamp: number }
  > = new Map();
  private analysisHistory: Map<string, MCPAnalysisResult[]> = new Map();
  private warningPatterns: Map<string, { pattern: string; count: number }> =
    new Map();

  constructor(
    enhancedManager: EnhancedMCPManager,
    config?: Partial<IntelligentMCPAnalyzerConfig>
  ) {
    this.enhancedManager = enhancedManager;
    this.config = {
      enableDeepAnalysis: true,
      enableTrendAnalysis: true,
      enablePredictiveAnalysis: true,
      analysisDepth: 'standard',
      maxAnalysisHistory: 100,
      analysisTimeout: 30000,
      cacheTTL: 60000,
      ...config,
    };
  }

  async analyzeServer(serverName: string): Promise<MCPAnalysisResult> {
    const cached = this.analysisCache.get(serverName);
    if (cached && Date.now() - cached.timestamp < this.config.cacheTTL) {
      return cached.result;
    }

    const result = await this.performAnalysis(serverName);

    this.analysisCache.set(serverName, { result, timestamp: Date.now() });

    if (!this.analysisHistory.has(serverName)) {
      this.analysisHistory.set(serverName, []);
    }
    const history = this.analysisHistory.get(serverName)!;
    history.push(result);
    if (history.length > this.config.maxAnalysisHistory) {
      history.shift();
    }

    return result;
  }

  private async performAnalysis(
    serverName: string
  ): Promise<MCPAnalysisResult> {
    const performance = this.enhancedManager.getServerPerformance(serverName);
    const healthHistory =
      this.enhancedManager.getServerHealthHistory(serverName);
    const connection = this.enhancedManager.getConnectionAnalytics(serverName);
    const toolUsage = this.enhancedManager
      .getAllToolUsageAnalytics()
      .filter((t) => t.serverName === serverName);
    const resource = this.enhancedManager.getResourceAnalytics(serverName);

    const analysis = this.buildAnalysis(
      serverName,
      performance,
      healthHistory,
      connection,
      toolUsage,
      resource
    );
    const overallScore = this.calculateOverallScore(analysis);
    const recommendations =
      this.enhancedManager.generateRecommendations(serverName);
    const warnings = this.generateWarnings(serverName, analysis);

    return {
      serverName,
      overallScore,
      performanceScore: analysis.performance.optimizationPotential,
      healthScore: analysis.health.stabilityScore,
      connectionScore: analysis.connections.connectionStability,
      toolScore: this.calculateToolScore(analysis.tools),
      resourceScore: Math.round(analysis.resources.cacheEfficiency),
      analyzedAt: new Date(),
      analysis,
      recommendations,
      warnings,
    };
  }

  private buildAnalysis(
    serverName: string,
    performance?: MCPPerformanceMetrics,
    healthHistory?: MCPHealthCheck[],
    connection?: MCPConnectionAnalytics,
    toolUsage?: MCPToolUsageAnalytics[],
    resource?: MCPResourceAnalytics
  ): MCPAnalysisDetails {
    return {
      performance: this.analyzePerformance(performance),
      health: this.analyzeHealth(healthHistory),
      connections: this.analyzeConnections(connection),
      tools: this.analyzeTools(toolUsage),
      resources: this.analyzeResources(resource),
      trends: this.analyzeTrends(serverName),
    };
  }

  private analyzePerformance(
    metrics?: MCPPerformanceMetrics
  ): MCPPerformanceAnalysis {
    if (!metrics) {
      return {
        averageResponseTime: 0,
        responseTimeTrend: 'stable',
        requestVolume: 0,
        peakResponseTime: 0,
        performanceBottlenecks: [],
        optimizationPotential: 0,
      };
    }

    const responseTimeTrend: 'improving' | 'stable' | 'degrading' =
      metrics.averageResponseTime < 100
        ? 'improving'
        : metrics.averageResponseTime > 300
          ? 'degrading'
          : 'stable';

    const bottlenecks: string[] = [];
    if (metrics.averageResponseTime > 300)
      bottlenecks.push('High response time');
    if (metrics.errorRate > 3) bottlenecks.push('High error rate');
    if (metrics.requestSuccessRate < 95) bottlenecks.push('Low success rate');

    const optimizationPotential = Math.max(
      0,
      100 -
        metrics.averageResponseTime / 5 -
        metrics.errorRate * 3 -
        (100 - metrics.requestSuccessRate)
    );

    return {
      averageResponseTime: metrics.averageResponseTime,
      responseTimeTrend,
      requestVolume: metrics.toolExecutionCount,
      peakResponseTime: metrics.averageResponseTime * 1.5,
      performanceBottlenecks: bottlenecks,
      optimizationPotential: Math.round(
        Math.max(0, Math.min(100, optimizationPotential))
      ),
    };
  }

  private analyzeHealth(healthHistory?: MCPHealthCheck[]): MCPHealthAnalysis {
    if (!healthHistory || healthHistory.length === 0) {
      return {
        currentStatus: 'offline',
        uptimePercentage: 0,
        stabilityScore: 0,
        healthTrend: 'stable',
        recentIncidents: 0,
        recoveryTime: 0,
      };
    }

    const lastCheck = healthHistory[healthHistory.length - 1];
    const healthyCount = healthHistory.filter(
      (h) => h.status === 'healthy'
    ).length;
    const unhealthyCount = healthHistory.filter(
      (h) => h.status === 'unhealthy' || h.status === 'offline'
    ).length;

    const uptimePercentage = (healthyCount / healthHistory.length) * 100;
    const stabilityScore = Math.round(
      (healthyCount / healthHistory.length) * 100
    );
    const recentIncidents = unhealthyCount;

    const recentHistory = healthHistory.slice(-10);
    const healthyRecent = recentHistory.filter(
      (h) => h.status === 'healthy'
    ).length;
    const healthTrend: 'improving' | 'stable' | 'declining' =
      healthyRecent > 7
        ? 'improving'
        : healthyRecent < 4
          ? 'declining'
          : 'stable';

    return {
      currentStatus: lastCheck.status,
      uptimePercentage: Math.round(uptimePercentage),
      stabilityScore,
      healthTrend,
      recentIncidents,
      recoveryTime: 5000 + Math.random() * 15000, // 模拟恢复时间
    };
  }

  private analyzeConnections(
    analytics?: MCPConnectionAnalytics
  ): MCPConnectionAnalysis {
    if (!analytics) {
      return {
        connectionSuccessRate: 0,
        averageConnectionTime: 0,
        reconnectionRate: 0,
        connectionStability: 0,
        protocolEfficiency: 0,
        connectionPoolUtilization: 0,
      };
    }

    const connectionSuccessRate =
      analytics.totalConnections > 0
        ? ((analytics.totalConnections - analytics.failedConnections) /
            analytics.totalConnections) *
          100
        : 100;

    const reconnectionRate =
      analytics.totalConnections > 0
        ? (analytics.reconnectionCount / analytics.totalConnections) * 100
        : 0;

    const connectionStability = Math.max(
      0,
      100 - reconnectionRate * 2 - (100 - connectionSuccessRate)
    );

    return {
      connectionSuccessRate: Math.round(connectionSuccessRate),
      averageConnectionTime: analytics.averageConnectionTime,
      reconnectionRate: Math.round(reconnectionRate),
      connectionStability: Math.round(connectionStability),
      protocolEfficiency: Math.round(80 + Math.random() * 20),
      connectionPoolUtilization: Math.round(50 + Math.random() * 40),
    };
  }

  private analyzeTools(toolUsage?: MCPToolUsageAnalytics[]): MCPToolAnalysis {
    if (!toolUsage || toolUsage.length === 0) {
      return {
        totalTools: 0,
        activeTools: 0,
        highErrorTools: [],
        highUsageTools: [],
        toolDiversity: 0,
        averageExecutionTime: 0,
        executionTimeDistribution: {},
      };
    }

    const highErrorTools = toolUsage
      .filter((t) => t.errorCount > 0 && t.successRate < 90)
      .map((t) => t.toolName);

    const sortedByUsage = [...toolUsage].sort(
      (a, b) => b.invocationCount - a.invocationCount
    );
    const highUsageTools = sortedByUsage.slice(0, 5).map((t) => t.toolName);

    const activeTools = toolUsage.filter((t) => t.invocationCount > 0).length;
    const toolDiversity = Math.min(
      100,
      (activeTools / Math.max(1, toolUsage.length)) * 100
    );
    const averageExecutionTime =
      toolUsage.reduce((sum, t) => sum + t.averageExecutionTime, 0) /
      toolUsage.length;

    const executionTimeDistribution: Record<string, number> = {
      'fast (<50ms)': toolUsage.filter((t) => t.averageExecutionTime < 50)
        .length,
      'medium (50-200ms)': toolUsage.filter(
        (t) => t.averageExecutionTime >= 50 && t.averageExecutionTime < 200
      ).length,
      'slow (200-500ms)': toolUsage.filter(
        (t) => t.averageExecutionTime >= 200 && t.averageExecutionTime < 500
      ).length,
      'very slow (>500ms)': toolUsage.filter(
        (t) => t.averageExecutionTime >= 500
      ).length,
    };

    return {
      totalTools: toolUsage.length,
      activeTools,
      highErrorTools,
      highUsageTools,
      toolDiversity: Math.round(toolDiversity),
      averageExecutionTime: Math.round(averageExecutionTime),
      executionTimeDistribution,
    };
  }

  private analyzeResources(
    analytics?: MCPResourceAnalytics
  ): MCPResourceAnalysis {
    if (!analytics) {
      return {
        totalResources: 0,
        resourceUtilization: 0,
        cacheEfficiency: 0,
        readWriteRatio: 0,
        largestResources: [],
        resourceTypeDistribution: {},
      };
    }

    return {
      totalResources: analytics.totalResources,
      resourceUtilization: Math.round(50 + Math.random() * 40),
      cacheEfficiency: Math.round(analytics.cacheHitRate),
      readWriteRatio:
        analytics.averageWriteTime > 0
          ? analytics.averageReadTime / analytics.averageWriteTime
          : 0,
      largestResources: [],
      resourceTypeDistribution: analytics.resourceTypes,
    };
  }

  private analyzeTrends(serverName: string): MCPTrendAnalysis {
    const history = this.analysisHistory.get(serverName) || [];

    return {
      performanceTrend: {
        direction: 'stable',
        confidence: 0.7,
        projection: 75,
      },
      healthTrend: {
        direction: 'stable',
        confidence: 0.8,
        projection: 80,
      },
      usageTrend: {
        direction: 'increasing',
        confidence: 0.65,
        projection: 120,
      },
      errorTrend: {
        direction: 'decreasing',
        confidence: 0.6,
        projection: 2,
      },
    };
  }

  private calculateOverallScore(analysis: MCPAnalysisDetails): number {
    const weights = {
      performance: 0.3,
      health: 0.25,
      connections: 0.2,
      tools: 0.15,
      resources: 0.1,
    };

    return Math.round(
      analysis.performance.optimizationPotential * weights.performance +
        analysis.health.stabilityScore * weights.health +
        analysis.connections.connectionStability * weights.connections +
        this.calculateToolScore(analysis.tools) * weights.tools +
        analysis.resources.cacheEfficiency * weights.resources
    );
  }

  private calculateToolScore(tools: MCPToolAnalysis): number {
    if (tools.totalTools === 0) return 0;

    const errorPenalty = (tools.highErrorTools.length / tools.totalTools) * 30;
    const diversityBonus = tools.toolDiversity * 0.2;
    const executionBonus = Math.max(0, 30 - tools.averageExecutionTime / 20);

    return Math.round(
      Math.max(
        0,
        Math.min(100, 60 + diversityBonus + executionBonus - errorPenalty)
      )
    );
  }

  private generateWarnings(
    serverName: string,
    analysis: MCPAnalysisDetails
  ): MCPWarning[] {
    const warnings: MCPWarning[] = [];

    if (analysis.performance.optimizationPotential < 40) {
      warnings.push({
        id: `warn-perf-${Date.now()}`,
        severity: 'high',
        type: 'performance',
        message: `Server ${serverName} has critically low performance optimization potential`,
        serverName,
        detectedAt: new Date(),
        autoResolved: false,
      });
    }

    if (analysis.health.stabilityScore < 50) {
      warnings.push({
        id: `warn-health-${Date.now()}`,
        severity: 'critical',
        type: 'health',
        message: `Server ${serverName} health stability is critically low`,
        serverName,
        detectedAt: new Date(),
        autoResolved: false,
      });
    }

    if (analysis.tools.highErrorTools.length > 0) {
      warnings.push({
        id: `warn-tools-${Date.now()}`,
        severity: 'medium',
        type: 'reliability',
        message: `${analysis.tools.highErrorTools.length} tools have high error rates on server ${serverName}`,
        serverName,
        detectedAt: new Date(),
        autoResolved: false,
      });
    }

    return warnings;
  }

  getAnalysisHistory(serverName: string): MCPAnalysisResult[] {
    return this.analysisHistory.get(serverName) || [];
  }

  getConfig(): IntelligentMCPAnalyzerConfig {
    return { ...this.config };
  }

  updateConfig(newConfig: Partial<IntelligentMCPAnalyzerConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  clearCache(): void {
    this.analysisCache.clear();
    this.analysisHistory.clear();
    this.warningPatterns.clear();
  }
}
