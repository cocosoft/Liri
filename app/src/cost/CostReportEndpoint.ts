/**
 * Cost HTTP 端点 /api/cost/report
 * 对标平安科技，对外暴露成本报告 HTTP 接口
 */
import { CostTracker } from './CostTracker';
import { CostMetricsBridge, getCostMetricsBridge } from './CostMetricsBridge';
import { canViewBillingCosts } from './BillingAccessControl';
import {
  DepartmentCostReporter,
  getDepartmentCostReporter,
} from './DepartmentCostReporter';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'cost:CostReportEndpoint',
  level: LogLevel.INFO,
});

/**
 * 成本报告请求
 */
export interface CostReportRequest {
  format?: 'json' | 'text' | 'csv' | 'prometheus';
  period?: 'today' | 'week' | 'month' | 'custom';
  startDate?: string;
  endDate?: string;
  includeDetails?: boolean;
  includeDepartment?: boolean;
}

/**
 * 成本报告响应
 */
export interface CostReportResponse {
  success: boolean;
  generatedAt: number;
  data: CostReportData;
  error?: string;
}

/**
 * 成本报告数据
 */
export interface CostReportData {
  totalCost: {
    allTime: number;
    period: number;
    currency: string;
  };
  tokenUsage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
    reasoning: number;
  };
  byModel: Array<{
    model: string;
    cost: number;
    tokens: number;
    requests: number;
  }>;
  dashboard?: ReturnType<CostMetricsBridge['generateDashboard']>;
  department?: ReturnType<DepartmentCostReporter['generateReport']>;
}

/**
 * Cost HTTP 端点处理器
 */
export class CostReportEndpoint {
  private costTracker: CostTracker;
  private metricsBridge: CostMetricsBridge;
  private departmentReporter: DepartmentCostReporter;

  /**
   * 构造函数
   * @param costTracker 成本跟踪器
   */
  constructor(costTracker: CostTracker) {
    this.costTracker = costTracker;
    this.metricsBridge = getCostMetricsBridge();
    this.departmentReporter = getDepartmentCostReporter();
  }

  /**
   * 处理 GET /api/cost/report
   * @param request 报告请求
   * @returns 报告响应
   */
  handleReport(request: CostReportRequest = {}): CostReportResponse {
    try {
      const data = this.buildReportData(request);

      return {
        success: true,
        generatedAt: Date.now(),
        data,
      };
    } catch (err) {
      return {
        success: false,
        generatedAt: Date.now(),
        data: this.emptyReport(),
        error: err instanceof Error ? err.message : '报告生成失败',
      };
    }
  }

  /**
   * 处理 GET /api/cost/report?format=prometheus
   * @returns Prometheus 格式文本
   */
  handlePrometheusReport(): string {
    return this.metricsBridge.exportPrometheus();
  }

  /**
   * 处理 GET /api/cost/report?format=text
   * @param request 请求
   * @returns 文本格式报告
   */
  handleTextReport(request: CostReportRequest): string {
    const data = this.buildReportData(request);
    const lines: string[] = [];

    lines.push('=== Liri 成本报告 ===');
    lines.push(`总历史成本: $${data.totalCost.allTime.toFixed(6)}`);
    lines.push('');

    lines.push('Token 使用:');
    lines.push(`  输入: ${data.tokenUsage.input.toLocaleString()}`);
    lines.push(`  输出: ${data.tokenUsage.output.toLocaleString()}`);
    lines.push(`  缓存: ${data.tokenUsage.cacheRead.toLocaleString()}`);
    lines.push(`  推理: ${data.tokenUsage.reasoning.toLocaleString()}`);
    lines.push('');

    lines.push('按模型:');
    for (const entry of data.byModel.slice(0, 20)) {
      lines.push(
        `  ${entry.model}: $${entry.cost.toFixed(6)} (${entry.tokens.toLocaleString()} tokens)`
      );
    }

    return lines.join('\n');
  }

  /**
   * 处理 GET /api/cost/report?format=csv
   * @param _request 请求
   * @returns CSV 格式文本
   */
  handleCSVReport(_request: CostReportRequest): string {
    const data = this.buildReportData(_request);
    const lines: string[] = [];

    lines.push('model,cost_usd,input_tokens,output_tokens,total_tokens');
    for (const entry of data.byModel) {
      lines.push(
        `${entry.model},${entry.cost.toFixed(6)},${entry.tokens.toLocaleString()},0,${entry.tokens.toLocaleString()}`
      );
    }

    return lines.join('\n');
  }

  /**
   * 处理带格式的成本报告
   * @param request 请求
   * @returns 格式化文本或 JSON
   */
  handle(request: CostReportRequest): string {
    switch (request.format) {
      case 'prometheus':
        return this.handlePrometheusReport();
      case 'text':
        return this.handleTextReport(request);
      case 'csv':
        return this.handleCSVReport(request);
      case 'json':
      default:
        return JSON.stringify(this.handleReport(request), null, 2);
    }
  }

  /**
   * 构建报告数据
   * @param request 请求
   * @returns 报告数据
   */
  private buildReportData(request: CostReportRequest): CostReportData {
    const modelUsage = this.costTracker.getModelUsage();
    const byModel: CostReportData['byModel'] = [];

    for (const [model, usage] of Object.entries(modelUsage)) {
      byModel.push({
        model,
        cost: usage.costUSD,
        tokens: usage.inputTokens + usage.outputTokens,
        requests: 1,
      });
    }

    byModel.sort((a, b) => b.cost - a.cost);

    const data: CostReportData = {
      totalCost: {
        allTime: this.costTracker.getTotalCostUSD(),
        period: 0,
        currency: 'USD',
      },
      tokenUsage: {
        input: this.costTracker.getTotalInputTokens(),
        output: this.costTracker.getTotalOutputTokens(),
        cacheRead: this.costTracker.getTotalCacheReadInputTokens(),
        cacheCreation: this.costTracker.getTotalCacheCreationInputTokens(),
        reasoning: (this.costTracker as any).totalReasoningTokens || 0,
      },
      byModel,
    };

    if (request.includeDetails) {
      data.dashboard = this.metricsBridge.generateDashboard();
    }

    if (request.includeDepartment) {
      const startDate = request.startDate
        ? new Date(request.startDate)
        : new Date(Date.now() - 30 * 24 * 3600_000);
      const endDate = request.endDate ? new Date(request.endDate) : new Date();

      data.department = this.departmentReporter.generateReport(
        startDate,
        endDate
      );
    }

    return data;
  }

  /**
   * 空报告
   */
  private emptyReport(): CostReportData {
    return {
      totalCost: { allTime: 0, period: 0, currency: 'USD' },
      tokenUsage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheCreation: 0,
        reasoning: 0,
      },
      byModel: [],
    };
  }
}
