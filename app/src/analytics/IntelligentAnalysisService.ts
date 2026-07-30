/**
 * 智能分析服务
 * 实现高级数据分析和智能洞察
 */

import { analyticsService } from './AnalyticsService';
import { performanceMonitoringService } from './PerformanceMonitoringService';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'analytics:intelligence',
  level: LogLevel.INFO,
});

/**
 * 智能分析服务类
 */
class IntelligentAnalysisService {
  private insights: Record<string, unknown>[] = [];
  private maxInsights = 1000;
  private analysisInterval = 60000;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  static instance: IntelligentAnalysisService;

  constructor() {
    this.initialize();
  }

  /**
   * 获取单例实例
   */
  static getInstance() {
    if (!IntelligentAnalysisService.instance) {
      IntelligentAnalysisService.instance = new IntelligentAnalysisService();
    }
    return IntelligentAnalysisService.instance;
  }

  /**
   * 初始化服务
   */
  initialize() {
    // 注册事件监听器
    analyticsService.on('eventTracked', (...args: unknown[]) => {
      const event = args[0] as Record<string, unknown>;
      this.analyzeEvent(event);
    });

    analyticsService.on('sessionEnded', (...args: unknown[]) => {
      const session = args[0] as Record<string, unknown>;
      this.analyzeSession(session);
    });
  }

  /**
   * 开始智能分析
   */
  startAnalysis() {
    if (this.intervalId) {
      return;
    }

    this.intervalId = setInterval(() => {
      this.performAnalysis();
    }, this.analysisInterval);

    logger.info('智能分析已启动');
  }

  /**
   * 停止智能分析
   */
  stopAnalysis() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('智能分析已停止');
    }
  }

  /**
   * 执行分析
   */
  performAnalysis() {
    this.analyzeSystemPerformance();
    this.analyzeUsagePatterns();
    this.analyzeErrorTrends();
  }

  /**
   * 分析事件
   * @param event 事件记录
   */
  analyzeEvent(event: Record<string, unknown>) {
    // 分析错误事件
    if (event.type === 'error') {
      this.analyzeErrorEvent(event);
    }

    // 分析性能事件
    if (event.type === 'performance') {
      this.analyzePerformanceEvent(event);
    }
  }

  /**
   * 分析会话
   * @param session 会话信息
   */
  analyzeSession(session: Record<string, unknown>) {
    // 分析会话持续时间
    if ((session.totalDuration as number) > 3600000) {
      // 超过1小时
      this.generateInsight('usage_pattern', {
        title: '长时间会话',
        description: `用户 ${String(session.user_id)} 的会话持续时间超过1小时`,
        severity: 'medium',
        data: { session },
        recommendations: ['检查用户是否遇到了问题', '考虑优化长时间运行的操作'],
      });
    }

    // 分析交互次数
    if ((session.interactionCount as number) > 100) {
      this.generateInsight('usage_pattern', {
        title: '高频交互',
        description: `用户 ${String(session.user_id)} 在单个会话中进行了 ${String(session.interactionCount)} 次交互`,
        severity: 'low',
        data: { session },
        recommendations: ['分析用户行为模式', '考虑提供批量操作功能'],
      });
    }
  }

  /**
   * 分析错误事件
   * @param event 错误事件
   */
  analyzeErrorEvent(event: Record<string, unknown>) {
    this.generateInsight('error_trend', {
      title: '错误事件',
      description: `发生错误: ${String(event.name)}`,
      severity: 'medium',
      data: { event },
      recommendations: ['检查错误原因', '修复相关代码'],
    });
  }

  /**
   * 分析性能事件
   * @param event 性能事件
   */
  analyzePerformanceEvent(event: Record<string, unknown>) {
    const metadata = event.metadata as Record<string, unknown>;
    const duration = metadata.duration_ms as number | undefined;
    if (duration && duration > 1000) {
      this.generateInsight('performance_issue', {
        title: '性能问题',
        description: `操作 ${String(event.name)} 执行时间过长: ${duration}ms`,
        severity: 'medium',
        data: { event },
        recommendations: ['优化操作性能', '考虑缓存策略'],
      });
    }
  }

  /**
   * 分析系统性能
   */
  analyzeSystemPerformance() {
    const anomalies = performanceMonitoringService.detectAnomalies();

    for (const anomaly of anomalies) {
      this.generateInsight('anomaly', {
        title: '系统异常',
        description: anomaly.message,
        severity: anomaly.severity,
        data: { anomaly },
        recommendations: ['检查系统资源使用情况', '优化系统配置'],
      });
    }
  }

  /**
   * 分析使用模式
   */
  analyzeUsagePatterns() {
    const sessions = analyticsService.getAllSessions();
    if (sessions.length === 0) {
      return;
    }

    // 分析平均会话持续时间
    const totalDuration = (sessions as Array<{ totalDuration: number }>).reduce(
      (sum, session) => sum + session.totalDuration,
      0
    );
    const averageDuration = totalDuration / sessions.length;

    if (averageDuration > 300000) {
      // 超过5分钟
      this.generateInsight('usage_pattern', {
        title: '平均会话时间过长',
        description: `平均会话时间为 ${(averageDuration / 60000).toFixed(2)} 分钟`,
        severity: 'low',
        data: {
          averageDuration,
          sessionCount: sessions.length,
        },
        recommendations: ['分析用户行为', '优化用户体验'],
      });
    }
  }

  /**
   * 分析错误趋势
   */
  analyzeErrorTrends() {
    const errorEvents = analyticsService.getEvents({
      type: 'error',
      startTime: Date.now() - 3600000, // 最近1小时
    });

    if (errorEvents.length > 10) {
      this.generateInsight('error_trend', {
        title: '错误率过高',
        description: `最近1小时内发生了 ${errorEvents.length} 个错误`,
        severity: 'high',
        data: {
          errorCount: errorEvents.length,
          errors: errorEvents,
        },
        recommendations: ['检查系统稳定性', '修复高频错误'],
      });
    }
  }

  /**
   * 生成分析洞察
   * @param type 洞察类型
   * @param insightData 洞察数据
   */
  generateInsight(type: string, insightData: Record<string, unknown>) {
    const insight = {
      id: `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      timestamp: Date.now(),
      ...insightData,
    };

    this.insights.push(insight);

    if (this.insights.length > this.maxInsights) {
      this.insights.shift();
    }

    // 记录洞察事件
    analyticsService.trackEvent('system', 'insight_generated', {
      insight_type: type,
      insight_title: insightData.title,
      severity: insightData.severity,
    });
  }

  /**
   * 获取分析洞察
   * @param options 查询选项
   * @returns 洞察列表
   */
  getInsights(options: Record<string, unknown> = {}) {
    let result = [...this.insights];

    if (options.type) {
      result = result.filter((insight) => insight.type === options.type);
    }

    if (options.severity) {
      result = result.filter(
        (insight) => insight.severity === options.severity
      );
    }

    if (options.startTime) {
      result = result.filter(
        (insight) =>
          (insight.timestamp as number) >= (options.startTime as number)
      );
    }

    if (options.endTime) {
      result = result.filter(
        (insight) =>
          (insight.timestamp as number) <= (options.endTime as number)
      );
    }

    result.sort(
      (a: Record<string, unknown>, b: Record<string, unknown>) =>
        (b.timestamp as number) - (a.timestamp as number)
    );

    if (options.limit) {
      result = result.slice(0, options.limit as number);
    }

    return result;
  }

  /**
   * 获取系统健康状态
   * @returns 健康状态
   */
  getSystemHealthStatus() {
    const recentInsights = this.getInsights({
      startTime: Date.now() - 3600000, // 最近1小时
      limit: 10,
    });

    const highSeverityInsights = recentInsights.filter(
      (insight) => insight.severity === 'high'
    );
    const mediumSeverityInsights = recentInsights.filter(
      (insight) => insight.severity === 'medium'
    );

    const cpuStats = performanceMonitoringService.getMetricStats('cpu_usage');
    const memoryStats =
      performanceMonitoringService.getMetricStats('memory_usage');
    const errorRateStats =
      performanceMonitoringService.getMetricStats('error_rate');

    let status = 'healthy';
    let message = '系统运行正常';

    if (highSeverityInsights.length > 0) {
      status = 'critical';
      message = `系统存在严重问题: ${highSeverityInsights.length} 个严重洞察`;
    } else if (
      mediumSeverityInsights.length > 0 ||
      cpuStats.average > 80 ||
      memoryStats.average > 80
    ) {
      status = 'degraded';
      message = '系统性能下降';
    }

    return {
      status,
      message,
      metrics: {
        cpu_usage: cpuStats.average,
        memory_usage: memoryStats.average,
        error_rate: errorRateStats.average,
      },
      insights: recentInsights,
    };
  }

  /**
   * 导出分析数据
   * @param format 导出格式
   * @returns 导出的数据
   */
  exportData(format = 'json') {
    const data = {
      insights: this.insights,
      healthStatus: this.getSystemHealthStatus(),
    };

    if (format === 'json') {
      return JSON.stringify(data, null, 2);
    }

    return data;
  }

  /**
   * 清除所有数据
   */
  clearData() {
    this.insights = [];
  }

  /**
   * 重置服务
   */
  reset() {
    this.stopAnalysis();
    this.clearData();
  }
}

// 初始化单例
IntelligentAnalysisService.instance = new IntelligentAnalysisService();

/**
 * 导出单例
 */
export { IntelligentAnalysisService };
export const intelligentAnalysisService =
  IntelligentAnalysisService.getInstance();
