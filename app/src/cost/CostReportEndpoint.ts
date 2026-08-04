/**
 * Cost HTTP 端点 /api/cost/report
 * 对标平安科技，对外暴露成本报告 HTTP 接口
 */
import { CostMetricsBridge, getCostMetricsBridge } from './CostMetricsBridge';
import { getCostRecordRepository } from './CostRecordRepository';
import { canViewBillingCosts } from './BillingAccessControl';
import { handleError } from '@modules/error';
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
    inputTokens?: number;
    outputTokens?: number;
    requests: number;
  }>;
  dashboard?: ReturnType<CostMetricsBridge['generateDashboard']>;
  department?: ReturnType<DepartmentCostReporter['generateReport']>;
}

/**
 * Cost HTTP 端点处理器
 */
export class CostReportEndpoint {
  private metricsBridge: CostMetricsBridge;
  private departmentReporter: DepartmentCostReporter;

  constructor() {
    this.metricsBridge = getCostMetricsBridge();
    this.departmentReporter = getDepartmentCostReporter();
  }

  /**
   * 处理 GET /api/cost/report
   * @param request 报告请求
   * @returns 报告响应
   */
  async handleReport(
    request: CostReportRequest = {}
  ): Promise<CostReportResponse> {
    try {
      const data = await this.buildReportData(request);

      return {
        success: true,
        generatedAt: Date.now(),
        data,
      };
    } catch (err) {
      await handleError(err, { module: 'cost:report', action: 'generate' });
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
  async handleTextReport(request: CostReportRequest): Promise<string> {
    const data = await this.buildReportData(request);
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
   */
  async handleCSVReport(_request: CostReportRequest): Promise<string> {
    const data = await this.buildReportData(_request);
    const lines: string[] = [];

    lines.push('model,cost_usd,input_tokens,output_tokens,total_tokens');
    for (const entry of data.byModel) {
      // [v1.2] 修正：input/output 输出各自真实值（此前 input=total, output=0）
      const input = entry.inputTokens ?? 0;
      const output = entry.outputTokens ?? 0;
      lines.push(
        `${entry.model},${entry.cost.toFixed(6)},${input.toLocaleString()},${output.toLocaleString()},${entry.tokens.toLocaleString()}`
      );
    }

    return lines.join('\n');
  }

  /**
   * 处理带格式的成本报告
   * @param request 请求
   * @returns 格式化文本或 JSON
   */
  async handle(request: CostReportRequest): Promise<string> {
    switch (request.format) {
      case 'prometheus':
        return this.handlePrometheusReport();
      case 'text':
        return await this.handleTextReport(request);
      case 'csv':
        return await this.handleCSVReport(request);
      case 'json':
      default:
        return JSON.stringify(await this.handleReport(request), null, 2);
    }
  }

  /**
   * 构建报告数据
   * @param request 请求
   * @returns 报告数据
   */
  private async buildReportData(
    request: CostReportRequest
  ): Promise<CostReportData> {
    // [v1.2] 从 SQLite cost_records 聚合，不再读内存
    const repo = getCostRecordRepository();
    const startTime = request.startDate
      ? new Date(request.startDate).getTime()
      : undefined;
    const endTime = request.endDate
      ? new Date(request.endDate).getTime()
      : undefined;

    const agg = await repo.getAggregatedCosts({
      startTime,
      endTime,
    });

    const byModel: CostReportData['byModel'] = [];
    for (const [model, m] of Object.entries(agg.modelBreakdown)) {
      byModel.push({
        model,
        cost: m.totalCost,
        tokens: m.totalTokens,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        requests: m.requestCount,
      });
    }
    byModel.sort((a, b) => b.cost - a.cost);

    const data: CostReportData = {
      totalCost: {
        allTime: agg.totalCostUSD,
        period: agg.totalCostUSD,
        currency: 'USD',
      },
      tokenUsage: {
        input: agg.totalInputTokens,
        output: agg.totalOutputTokens,
        cacheRead: agg.totalCacheReadTokens,
        cacheCreation: agg.totalCacheCreationTokens,
        reasoning: 0,
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
