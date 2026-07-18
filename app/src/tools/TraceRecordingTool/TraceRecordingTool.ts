/**
 * TraceRecordingTool
 * AI Trace 录制数据查询工具
 * AI Agent 可通过此工具查询追踪记录、统计信息和导出数据
 */
import { BaseTool } from '../BaseTool.js';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index.js';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'tools:TraceRecordingTool:TraceRecordingTool', level: LogLevel.INFO });

/**
 * 获取 AITracePlugin 实例
 */
function getAITracePlugin(): any {
  try {
    const { getAITracePlugin } = require('../../trace-recording/index.js');
    return getAITracePlugin();
  } catch {
    return null;
  }
}

/**
 * 获取 TraceEngine 实例
 */
function getTraceEngine(): any {
  const plugin = getAITracePlugin();
  if (plugin && typeof plugin.getEngine === 'function') {
    return plugin.getEngine();
  }
  return null;
}

/**
 * TraceRecordingTool 工具类
 */
export class TraceRecordingTool extends BaseTool {
  /**
   * 工具名称
   */
  name = 'TraceRecordingTool';

  /**
   * 工具描述
   */
  description =
    '查询 AI API 调用追踪记录和统计信息。可获取录制状态、统计数据、最近调用记录，以及导出追踪数据。';

  /**
   * 工具参数
   */
  params: ToolParam[] = [
    {
      name: 'action',
      type: 'string',
      description: '要执行的操作类型',
      required: true,
      enum: ['get_stats', 'get_records', 'get_status', 'export_records'],
    },
    {
      name: 'limit',
      type: 'number',
      description: '返回记录数量上限（仅 get_records 有效）',
      required: false,
      default: 10,
    },
    {
      name: 'date',
      type: 'string',
      description: '按日期过滤记录，格式 YYYY-MM-DD（仅 get_records 有效）',
      required: false,
    },
    {
      name: 'format',
      type: 'string',
      description: '导出格式（仅 export_records 有效）',
      required: false,
      default: 'json',
      enum: ['json', 'md', 'html'],
    },
    {
      name: 'model',
      type: 'string',
      description: '按模型名称过滤（仅 get_records 有效）',
      required: false,
    },
  ];

  /**
   * 工具是否只读（所有操作均为查询，无副作用）
   */
  override isReadOnly(): boolean {
    return true;
  }

  /**
   * 工具是否并发安全
   */
  override isConcurrencySafe(): boolean {
    return true;
  }

  /**
   * 工具是否破坏性
   */
  override isDestructive(): boolean {
    return false;
  }

  /**
   * 执行工具
   */
  async execute(input: any, _context: ToolUseContext): Promise<ToolResult> {
    try {
      const { action, limit = 10, date, format = 'json', model } = input || {};

      switch (action) {
        case 'get_status':
          return this.getStatus();

        case 'get_stats':
          return this.getStats();

        case 'get_records':
          return this.getRecords(limit, date, model);

        case 'export_records':
          return this.exportRecords(format);

        default:
          return {
            success: false,
            error: `不支持的操作 "${action}"。可选操作: get_stats, get_records, get_status, export_records`,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: `TraceRecordingTool 执行失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * 获取录制状态
   */
  private getStatus(): ToolResult {
    const plugin = getAITracePlugin();

    if (!plugin) {
      return {
        success: true,
        data: {
          active: false,
          message: 'AI Trace 录制模块未启动',
        },
      };
    }

    const status =
      typeof plugin.getStatus === 'function' ? plugin.getStatus() : {};

    return {
      success: true,
      data: {
        active: true,
        config: status.config || {},
        monitoringDeps: {
          dashboard: !!status.monitoringDeps?.dashboard,
          tracing: !!status.monitoringDeps?.tracing,
          alertManager: !!status.monitoringDeps?.alertManager,
        },
      },
    };
  }

  /**
   * 获取统计数据
   */
  private getStats(): ToolResult {
    const engine = getTraceEngine();

    if (!engine) {
      return {
        success: true,
        data: { active: false, message: 'Trace 引擎未启动' },
      };
    }

    let stats: any;
    try {
      stats = engine.getStatsSnapshot();
    } catch {
      return {
        success: true,
        data: { active: true, message: '统计数据不可用' },
      };
    }

    if (!stats || stats.totalCalls === 0) {
      return {
        success: true,
        data: { active: true, totalCalls: 0, message: '暂无录制数据' },
      };
    }

    return {
      success: true,
      data: {
        active: true,
        totalCalls: stats.totalCalls,
        totalErrors: stats.totalErrors,
        errorRate:
          stats.totalCalls > 0
            ? Number(((stats.totalErrors / stats.totalCalls) * 100).toFixed(2))
            : 0,
        latencyMs: {
          p50: stats.latencyP50 || 0,
          p99: stats.latencyP99 || 0,
        },
        tokens: {
          input: stats.totalInputTokens || 0,
          output: stats.totalOutputTokens || 0,
          cacheRead: stats.totalCacheReadTokens || 0,
          cacheCreate: stats.totalCacheCreateTokens || 0,
        },
        byModel: stats.callsByModel || {},
      },
    };
  }

  /**
   * 获取录制记录
   */
  private getRecords(limit: number, date?: string, model?: string): ToolResult {
    const engine = getTraceEngine();

    if (!engine) {
      return {
        success: true,
        data: { records: [], message: 'Trace 引擎未启动' },
      };
    }

    try {
      let records: any[];

      if (date) {
        records = engine.getRecordsByDate(date) || [];
      } else {
        records = engine.getRecentRecords(limit) || [];
      }

      if (model) {
        records = records.filter((r: any) =>
          r.model?.toLowerCase().includes(model.toLowerCase())
        );
      }

      records = records.slice(0, limit);

      const simplified = records.map((rec: any) => ({
        id: rec.id,
        timestamp: rec.timestamp,
        model: rec.model,
        durationMs: rec.durationMs,
        statusCode: rec.statusCode,
        error: rec.error || null,
        tokens: rec.usage
          ? {
              input: rec.usage.input_tokens || rec.usage.prompt_tokens || 0,
              output:
                rec.usage.output_tokens || rec.usage.completion_tokens || 0,
            }
          : null,
        traceId: rec.traceId || null,
      }));

      return {
        success: true,
        data: {
          total: records.length,
          records: simplified,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `获取记录失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * 导出录制数据
   */
  private async exportRecords(format: string): Promise<ToolResult> {
    const engine = getTraceEngine();

    if (!engine) {
      return {
        success: false,
        error: 'Trace 引擎未启动，无法导出数据',
      };
    }

    try {
      const allRecords = engine.getAllRecords() || [];

      if (allRecords.length === 0) {
        return {
          success: true,
          data: { records: [], message: '暂无录制数据可导出' },
        };
      }

      if (format === 'json') {
        return {
          success: true,
          data: {
            format: 'json',
            recordCount: allRecords.length,
            records: allRecords,
          },
        };
      }

      const {
        ExportService,
      } = require('../../trace-recording/export/ExportService.js');
      const exportService = new ExportService();
      const content = await exportService.export(
        allRecords,
        format as 'md' | 'json' | 'html'
      );

      return {
        success: true,
        data: {
          format,
          recordCount: allRecords.length,
          content:
            typeof content === 'string' ? content.substring(0, 50000) : content,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `导出失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

export default TraceRecordingTool;
