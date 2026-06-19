/**
 * 治理报告服务
 * 生成详细的治理执行报告
 */

import { GovernanceManager } from './managers/GovernanceManager';
import {
  governanceAuditService,
  AuditEvent,
} from './managers/GovernanceAuditService';
import {
  governanceStrategyManager,
  GovernanceStrategy,
} from './managers/GovernanceStrategyManager';

/**
 * 报告配置
 */
export interface ReportConfig {
  title?: string;
  includeStrategyDetails?: boolean;
  includeAuditDetails?: boolean;
  includeViolationDetails?: boolean;
  includeRecommendation?: boolean;
  dateRange?: {
    start: Date;
    end: Date;
  };
  format?: 'json' | 'markdown';
}

/**
 * 报告摘要
 */
export interface ReportSummary {
  totalExecutions: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  averageExecutionTime: number;
  totalViolations: number;
  topBlockedTools: Array<{ toolName: string; count: number }>;
  topFailedTools: Array<{ toolName: string; count: number }>;
}

/**
 * 策略命中分析
 */
export interface StrategyHitAnalysis {
  strategyName: string;
  strategyType: string;
  totalHits: number;
  rules: Array<{
    ruleId: string;
    ruleTarget: string;
    ruleAction: string;
    hitCount: number;
  }>;
}

/**
 * 时间分布
 */
export interface TimeDistribution {
  hourly: Record<string, number>;
  daily: Record<string, number>;
}

/**
 * 治理报告
 */
export interface GovernanceReport {
  metadata: {
    title: string;
    generatedAt: Date;
    dateRange?: {
      start: Date;
      end: Date;
    };
    version: string;
  };
  summary: ReportSummary;
  strategyAnalysis: StrategyHitAnalysis[];
  timeDistribution: TimeDistribution;
  topEvents: AuditEvent[];
  recommendations: string[];
  config?: {
    enabled: boolean;
    enforcePermission: boolean;
    enforceSandbox: boolean;
    enforceHooks: boolean;
    activeStrategy?: GovernanceStrategy;
  };
}

/**
 * 治理报告服务
 */
export class GovernanceReportService {
  private static instance: GovernanceReportService;
  private governanceManager: GovernanceManager;

  private constructor() {
    this.governanceManager = GovernanceManager.getInstance();
  }

  /**
   * 获取单例实例
   */
  static getInstance(): GovernanceReportService {
    if (!GovernanceReportService.instance) {
      GovernanceReportService.instance = new GovernanceReportService();
    }
    return GovernanceReportService.instance;
  }

  /**
   * 生成治理报告
   */
  generateReport(config: ReportConfig = {}): GovernanceReport {
    const {
      title = '治理执行报告',
      includeStrategyDetails = true,
      includeAuditDetails = true,
      includeViolationDetails = true,
      includeRecommendation = true,
      dateRange,
      format = 'json',
    } = config;

    const report: GovernanceReport = {
      metadata: {
        title,
        generatedAt: new Date(),
        version: '1.0.0',
      },
      summary: this.generateSummary(dateRange),
      strategyAnalysis: includeStrategyDetails
        ? this.generateStrategyAnalysis()
        : [],
      timeDistribution: this.generateTimeDistribution(dateRange),
      topEvents: includeAuditDetails ? this.getTopEvents(dateRange) : [],
      recommendations: includeRecommendation
        ? this.generateRecommendations()
        : [],
    };

    if (dateRange) {
      report.metadata.dateRange = dateRange;
    }

    const govConfig = this.governanceManager.getConfig();
    report.config = {
      enabled: govConfig.enabled,
      enforcePermission: govConfig.enforcePermission,
      enforceSandbox: govConfig.enforceSandbox,
      enforceHooks: govConfig.enforceHooks,
      activeStrategy: governanceStrategyManager.getActiveStrategy(),
    };

    if (format === 'markdown') {
      return this.convertToMarkdownReport(report);
    }

    return report;
  }

  /**
   * 生成摘要
   */
  private generateSummary(dateRange?: {
    start: Date;
    end: Date;
  }): ReportSummary {
    const stats = this.governanceManager.getStats();
    const auditStats = stats.auditStats;

    const totalExecutions = auditStats.totalEvents || 0;
    const successCount = auditStats.eventsByStatus?.success || 0;
    const failureCount = auditStats.eventsByStatus?.failure || 0;
    const successRate =
      totalExecutions > 0 ? (successCount / totalExecutions) * 100 : 0;

    const topBlockedTools = this.getTopToolsByCount(
      auditStats.eventsByTool || {},
      stats.violations || {}
    );

    const topFailedTools = this.getTopToolsByStatus(
      auditStats.eventsByTool || {},
      'failure'
    );

    return {
      totalExecutions,
      successCount,
      failureCount,
      successRate,
      averageExecutionTime: auditStats.averageExecutionTime || 0,
      totalViolations: Object.values(stats.violations || {}).reduce(
        (a, b) => a + b,
        0
      ),
      topBlockedTools,
      topFailedTools,
    };
  }

  /**
   * 获取Top工具
   */
  private getTopToolsByCount(
    eventsByTool: Record<string, number>,
    violations: Record<string, number>
  ): Array<{ toolName: string; count: number }> {
    const toolCounts: Record<string, number> = {};

    for (const [toolName, count] of Object.entries(eventsByTool)) {
      toolCounts[toolName] = count;
    }

    for (const [toolName, count] of Object.entries(violations)) {
      toolCounts[toolName] = (toolCounts[toolName] || 0) + count;
    }

    return Object.entries(toolCounts)
      .map(([toolName, count]) => ({ toolName, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }

  /**
   * 获取Top失败工具
   */
  private getTopToolsByStatus(
    eventsByTool: Record<string, number>,
    status: string
  ): Array<{ toolName: string; count: number }> {
    const events = governanceAuditService.queryEvents({});

    const statusCounts: Record<string, number> = {};

    for (const event of events) {
      if ((event.data?.result as Record<string, unknown> | undefined)?.success === false) {
        statusCounts[event.toolName] = (statusCounts[event.toolName] || 0) + 1;
      }
    }

    return Object.entries(statusCounts)
      .map(([toolName, count]) => ({ toolName, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }

  /**
   * 生成策略分析
   */
  private generateStrategyAnalysis(): StrategyHitAnalysis[] {
    const activeStrategy = governanceStrategyManager.getActiveStrategy();

    if (!activeStrategy) {
      return [];
    }

    const events = governanceAuditService.queryEvents({});
    const ruleHits: Record<string, number> = {};

    for (const event of events) {
      if (event.data?.result) {
        for (const rule of activeStrategy.rules) {
          if (rule.target === event.toolName || rule.target === '*') {
            ruleHits[rule.id] = (ruleHits[rule.id] || 0) + 1;
          }
        }
      }
    }

    return [
      {
        strategyName: activeStrategy.name,
        strategyType: activeStrategy.type,
        totalHits: Object.values(ruleHits).reduce((a, b) => a + b, 0),
        rules: activeStrategy.rules.map((rule) => ({
          ruleId: rule.id,
          ruleTarget: rule.target,
          ruleAction: rule.action,
          hitCount: ruleHits[rule.id] || 0,
        })),
      },
    ];
  }

  /**
   * 生成时间分布
   */
  private generateTimeDistribution(dateRange?: {
    start: Date;
    end: Date;
  }): TimeDistribution {
    const events = governanceAuditService.queryEvents({
      startDate: dateRange?.start.getTime(),
      endDate: dateRange?.end.getTime(),
      limit: 1000,
    });

    const hourly: Record<string, number> = {};
    const daily: Record<string, number> = {};

    for (let i = 0; i < 24; i++) {
      hourly[`${i.toString().padStart(2, '0')}:00`] = 0;
    }

    for (const event of events) {
      const timestamp =
        event.timestamp instanceof Date
          ? event.timestamp
          : new Date(event.timestamp);

      const hour = `${timestamp.getHours().toString().padStart(2, '0')}:00`;
      const day = timestamp.toISOString().split('T')[0];

      hourly[hour] = (hourly[hour] || 0) + 1;
      daily[day] = (daily[day] || 0) + 1;
    }

    return { hourly, daily };
  }

  /**
   * 获取Top事件
   */
  private getTopEvents(dateRange?: { start: Date; end: Date }): AuditEvent[] {
    return governanceAuditService.queryEvents({
      startDate: dateRange?.start.getTime(),
      endDate: dateRange?.end.getTime(),
      limit: 20,
    });
  }

  /**
   * 生成建议
   */
  private generateRecommendations(): string[] {
    const recommendations: string[] = [];
    const stats = this.governanceManager.getStats();

    if (stats.violations) {
      const totalViolations = Object.values(stats.violations).reduce(
        (a, b) => a + b,
        0
      );
      if (totalViolations > 10) {
        recommendations.push('检测到较多沙箱违规，建议加强沙箱配置');
      }
    }

    const auditStats = stats.auditStats;
    if (auditStats.successRate < 80) {
      recommendations.push('执行成功率较低，建议检查权限配置和策略设置');
    }

    if (!governanceStrategyManager.getActiveStrategy()) {
      recommendations.push('当前没有激活的治理策略，建议选择一个合适的策略');
    }

    const strategy = governanceStrategyManager.getActiveStrategy();
    if (strategy && strategy.type === 'permissive') {
      recommendations.push('当前使用宽松策略，建议在生产环境使用更严格的策略');
    }

    if (recommendations.length === 0) {
      recommendations.push('治理系统运行正常，未发现需要优化的问题');
    }

    return recommendations;
  }

  /**
   * 转换为Markdown格式
   */
  private convertToMarkdownReport(report: GovernanceReport): GovernanceReport {
    const mdContent = this.generateMarkdown(report);

    return {
      ...report,
      metadata: {
        ...report.metadata,
        title: `${report.metadata.title}\n\n${mdContent}`,
      },
    } as GovernanceReport;
  }

  /**
   * 生成Markdown格式报告
   */
  generateMarkdown(report: GovernanceReport): string {
    const lines: string[] = [];

    lines.push(`# ${report.metadata.title}`);
    lines.push('');
    lines.push(`**生成时间**: ${report.metadata.generatedAt.toISOString()}`);
    lines.push('');

    if (report.metadata.dateRange) {
      lines.push(
        `**日期范围**: ${report.metadata.dateRange.start.toISOString()} - ${report.metadata.dateRange.end.toISOString()}`
      );
      lines.push('');
    }

    lines.push('## 执行摘要');
    lines.push('');
    lines.push(`| 指标 | 值 |`);
    lines.push(`|------|-----|`);
    lines.push(`| 总执行次数 | ${report.summary.totalExecutions} |`);
    lines.push(`| 成功次数 | ${report.summary.successCount} |`);
    lines.push(`| 失败次数 | ${report.summary.failureCount} |`);
    lines.push(`| 成功率 | ${report.summary.successRate.toFixed(2)}% |`);
    lines.push(
      `| 平均执行时间 | ${report.summary.averageExecutionTime.toFixed(2)}ms |`
    );
    lines.push(`| 总违规次数 | ${report.summary.totalViolations} |`);
    lines.push('');

    if (report.summary.topBlockedTools.length > 0) {
      lines.push('### Top阻塞工具');
      lines.push('');
      lines.push('| 工具名称 | 阻塞次数 |');
      lines.push('|---------|---------|');
      for (const tool of report.summary.topBlockedTools) {
        lines.push(`| ${tool.toolName} | ${tool.count} |`);
      }
      lines.push('');
    }

    if (report.config) {
      lines.push('## 治理配置');
      lines.push('');
      lines.push(`- 治理启用: ${report.config.enabled ? '是' : '否'}`);
      lines.push(
        `- 权限强制: ${report.config.enforcePermission ? '是' : '否'}`
      );
      lines.push(`- 沙箱强制: ${report.config.enforceSandbox ? '是' : '否'}`);
      lines.push(`- Hooks强制: ${report.config.enforceHooks ? '是' : '否'}`);
      if (report.config.activeStrategy) {
        lines.push(
          `- 活跃策略: ${report.config.activeStrategy.name} (${report.config.activeStrategy.type})`
        );
      }
      lines.push('');
    }

    if (report.strategyAnalysis.length > 0) {
      lines.push('## 策略分析');
      lines.push('');
      for (const analysis of report.strategyAnalysis) {
        lines.push(`### ${analysis.strategyName}`);
        lines.push('');
        lines.push(`- 策略类型: ${analysis.strategyType}`);
        lines.push(`- 总命中次数: ${analysis.totalHits}`);
        lines.push('');
        lines.push('| 规则ID | 目标 | 动作 | 命中次数 |');
        lines.push('|--------|------|------|---------|');
        for (const rule of analysis.rules) {
          lines.push(
            `| ${rule.ruleId} | ${rule.ruleTarget} | ${rule.ruleAction} | ${rule.hitCount} |`
          );
        }
        lines.push('');
      }
    }

    if (report.recommendations.length > 0) {
      lines.push('## 建议');
      lines.push('');
      for (const recommendation of report.recommendations) {
        lines.push(`- ${recommendation}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * 导出报告
   */
  exportReport(config: ReportConfig = {}): string {
    const report = this.generateReport(config);

    if (config.format === 'markdown') {
      return this.generateMarkdown(report);
    }

    return JSON.stringify(report, null, 2);
  }

  /**
   * 保存报告到文件
   */
  async saveReportToFile(
    filePath: string,
    config: ReportConfig = {}
  ): Promise<void> {
    const content = this.exportReport(config);

    const { writeFileSync } = await import('fs');
    writeFileSync(filePath, content, 'utf-8');
  }
}

/**
 * 导出单例
 */
export const governanceReportService = GovernanceReportService.getInstance();
