import { TOOL_NAME_CONSTANTS } from '../toolNameConstants';
/**
 * TraceRecordingTool
 * AI Trace 录制数据查询工具
 * AI Agent 可通过此工具查询追踪记录、统计信息和导出数据
 */
import { BaseTool } from '../BaseTool.js';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index.js';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:TraceRecordingTool:TraceRecordingTool');

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
 * U-03（2026-10-19）：`trace_recording` 的**模型可见出参结构**（JSON Schema）。
 *
 * 出口按 action 分四类（`get_status` / `get_stats` / `get_records` / `export_records`），
 * 另含「引擎未启动 / 暂无数据」提示分支（`active` 或 `message`）⇒ 不设根级 required。
 */
const TRACE_RECORDING_OUTPUT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    active: { type: 'boolean', description: '录制模块/引擎是否已启动' },
    message: { type: 'string', description: '不可用或空数据提示' },
    config: { type: 'object', description: '录制配置（get_status 分支）' },
    monitoringDeps: {
      type: 'object',
      description: '监控依赖可用性（get_status 分支）',
      properties: {
        dashboard: { type: 'boolean', description: 'Dashboard 是否就绪' },
        tracing: { type: 'boolean', description: 'Tracing 是否就绪' },
        alertManager: { type: 'boolean', description: '告警管理器是否就绪' },
      },
      required: ['dashboard', 'tracing', 'alertManager'],
    },
    totalCalls: { type: 'number', description: '录制到的调用总数' },
    totalErrors: { type: 'number', description: '错误调用数' },
    errorRate: { type: 'number', description: '错误率（百分比，保留两位）' },
    latencyMs: {
      type: 'object',
      description: '延迟分位（毫秒）',
      properties: {
        p50: { type: 'number', description: 'P50 延迟' },
        p99: { type: 'number', description: 'P99 延迟' },
      },
      required: ['p50', 'p99'],
    },
    tokens: {
      type: 'object',
      description: '用量汇总（stats）或单条记录用量（records，可能为 null）',
      properties: {
        input: { type: 'number', description: '输入 token' },
        output: { type: 'number', description: '输出 token' },
        cacheRead: { type: 'number', description: '缓存读取 token（stats）' },
        cacheCreate: { type: 'number', description: '缓存写入 token（stats）' },
      },
      required: ['input', 'output'],
    },
    byModel: {
      type: 'object',
      description: '按模型分组的调用计数',
      additionalProperties: { type: 'number' },
    },
    total: { type: 'number', description: '本次返回的记录数（get_records）' },
    records: {
      type: 'array',
      description: '录制记录（get_records / export_records 分支）',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '记录 ID' },
          timestamp: { description: '记录时间戳（随引擎来源为毫秒或 ISO）' },
          model: { type: 'string', description: '模型名（缺失时为 unknown）' },
          durationMs: { type: 'number', description: '请求耗时（毫秒）' },
          statusCode: { type: 'number', description: 'HTTP 状态码' },
          phase: { type: 'string', description: '调用阶段' },
          error: {
            type: ['string', 'null'],
            description: '错误信息（无错误为 null）',
          },
          tokens: {
            type: ['object', 'null'],
            description: '单条记录用量（无用量为 null）',
            properties: {
              input: { type: 'number', description: '输入 token' },
              output: { type: 'number', description: '输出 token' },
            },
            required: ['input', 'output'],
          },
          traceId: {
            type: ['string', 'null'],
            description: '链路 ID（无则 null）',
          },
        },
        required: ['id', 'model'],
      },
    },
    format: {
      type: 'string',
      enum: ['json', 'md', 'html'],
      description: '导出格式（export_records 分支）',
    },
    recordCount: { type: 'number', description: '导出的记录数' },
    content: {
      type: 'string',
      description: '导出内容（md/html 分支，最长 50000 字符）',
    },
  },
};

/**
 * TraceRecordingTool 工具类
 */
export class TraceRecordingTool extends BaseTool {
  /**
   * 工具名称
   */
  name = TOOL_NAME_CONSTANTS.trace_recording;

  /**
   * 工具描述
   */
  description =
    '查询 AI API 调用追踪记录和统计信息。可获取录制状态、统计数据、最近调用记录，以及导出追踪数据。';

  /** U-03（2026-10-19）：模型可见出参结构（按 action 分支） */
  override outputJsonSchema = TRACE_RECORDING_OUTPUT_JSON_SCHEMA;

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

      // v5 方案 3.6：统一两条路径返回 shape——
      //  无 date 走 getRecentRecords（IndexEntry：status 为 HTTP 码、model 直取）
      //  有 date 走 getRecordsByDate（TraceRecord：response.status、request.body.model）
      const simplified = records.map((rec: any) => ({
        id: rec.id,
        timestamp: rec.timestamp,
        model: rec.model || rec.request?.body?.model || 'unknown',
        durationMs: rec.durationMs,
        statusCode: rec.response?.status ?? rec.status,
        phase: rec.phase,
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
