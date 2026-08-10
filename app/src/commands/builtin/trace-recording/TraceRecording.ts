/**
 * TraceRecording 命令
 * AI Trace 录制模块的交互式命令
 * 提供状态查看、统计查询、数据导出、记录列表等功能
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from 'fs';
import { join, resolve } from 'path';
import { resolveOutputDir } from '@modules/core';
import type { CommandContext, CommandResult } from '@modules/commands';

import { handleError } from '@modules/error';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('commands:builtin:trace-recording:TraceRecording');

/**
 * 获取 AITracePlugin 实例
 */
function getAITracePlugin(): any {
  try {
    const { getAITracePlugin } = require('../../../trace-recording/index.js');
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
 * 格式化字节大小
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/**
 * 格式化时间戳
 */
function formatTimestamp(date: Date): string {
  const y = date.getFullYear();
  const M = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${M}-${d} ${h}:${m}:${s}`;
}

/**
 * 计算相对时间描述
 */
function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  return `${Math.floor(diff / 86400000)}天前`;
}

/**
 * TraceRecording 命令实现
 */
const traceRecordingCommand = {
  /**
   * 命令名称
   */
  name: 'trace',

  /**
   * 命令别名
   */
  aliases: ['ai-trace', 'tracer'],

  /**
   * 命令描述
   */
  description: 'AI Trace 录制模块 — 查看和管理 AI API 调用追踪记录',

  /**
   * 用法提示
   */
  argumentHint:
    '<subcommand> [options] (status/stats/export/view/records/help)',

  /**
   * 执行命令
   */
  async execute(
    args: string,
    _context: CommandContext
  ): Promise<CommandResult> {
    const cleanArgs = args.trim();
    const [subcommand, ...rest] = cleanArgs.split(/\s+/);

    switch (subcommand) {
      case 'status':
      case 'st':
        return this.handleStatus();

      case 'stats':
        return this.handleStats();

      case 'export':
      case 'e':
        return this.handleExport(rest);

      case 'view':
      case 'v':
        return this.handleView(rest);

      case 'records':
      case 'rec':
      case 'r':
        return this.handleRecords(rest);

      case 'help':
      case '--help':
      case '-h':
      case '':
        return this.showHelp();

      default:
        return {
          success: false,
          type: 'text',
          message: `未知子命令 "${subcommand}"。输入 /trace help 查看帮助。`,
        };
    }
  },

  /**
   * 显示帮助信息
   */
  showHelp(): CommandResult {
    const help = [
      '🔍 AI Trace 录制模块 — 命令帮助',
      '',
      '用法:',
      '  /trace <子命令> [参数]',
      '',
      '子命令:',
      '  status, st        查看录制模块运行状态',
      '  stats             查看 AI 调用统计数据',
      '  export, e <格式>   导出跟踪数据到文件 (md/json/html)',
      '  view, v [文件]     生成 HTML 查看器',
      '  records, r [日期]  列出录制记录（可选按日期过滤，格式 YYYY-MM-DD）',
      '  help              显示此帮助信息',
      '',
      '示例:',
      '  /trace status',
      '  /trace stats',
      '  /trace export md',
      '  /trace export json ./output',
      '  /trace view',
      '  /trace records',
      '  /trace records 2026-05-14',
    ].join('\n');

    return { success: true, type: 'text', message: help };
  },

  /**
   * 查看录制模块运行状态
   */
  handleStatus(): CommandResult {
    const plugin = getAITracePlugin();
    const engine = getTraceEngine();
    const lines: string[] = [];

    if (!plugin) {
      lines.push('❌ AI Trace 录制模块未启动');
      lines.push('');
      lines.push('可能原因:');
      lines.push('  - 模块未被初始化');
      lines.push('  - 环境变量 AI_TRACE_MODE 未设置');
      lines.push('');
      lines.push('可通过以下方式启用:');
      lines.push('  - 设置环境变量 AI_TRACE_MODE=all 后重启');
      return {
        success: true,
        type: 'text',
        message: lines.join('\n'),
        data: { active: false },
      };
    }

    const status =
      typeof plugin.getStatus === 'function' ? plugin.getStatus() : {};
    const config = status.config || {};

    lines.push('✅ AI Trace 录制模块运行中');
    lines.push('');
    lines.push('配置信息:');
    lines.push(`  追踪目录: ${config.traceDir || 'traces/'}`);
    lines.push(`  录制模式: ${config.mode || 'all'}`);
    lines.push(`  慢请求阈值: ${config.slowThresholdMs || 30000}ms`);
    lines.push(`  LiveView 端口: ${config.liveViewPort || '未启动'}`);
    lines.push('');

    if (engine) {
      try {
        const allRecords = engine.getAllRecords();
        const availableDates = engine.getAvailableDates();
        lines.push('运行数据:');
        lines.push(
          `  记录总数: ${Array.isArray(allRecords) ? allRecords.length : 0}`
        );
        lines.push(
          `  可用日期: ${Array.isArray(availableDates) ? availableDates.length : 0} 天`
        );
      } catch (err) {
        // 忽略引擎查询错误

        handleError(err, {
          module: 'commands:builtin:trace-recording:TraceRecording',
          action: 'ignoreEngineQueryError',
        });
      }
    }

    lines.push('');
    lines.push('集成的监控服务:');
    const deps = status.monitoringDeps || {};
    lines.push(`  Dashboard: ${deps.dashboard ? '✅ 已连接' : '❌ 未连接'}`);
    lines.push(`  Tracing:   ${deps.tracing ? '✅ 已连接' : '❌ 未连接'}`);
    lines.push(`  Alert:     ${deps.alertManager ? '✅ 已连接' : '❌ 未连接'}`);

    return {
      success: true,
      type: 'text',
      message: lines.join('\n'),
      data: { active: true, status, config },
    };
  },

  /**
   * 查看 AI 调用统计数据
   */
  handleStats(): CommandResult {
    const engine = getTraceEngine();

    if (!engine) {
      return {
        success: false,
        type: 'text',
        message: '❌ AI Trace 引擎未启动，无法获取统计数据。',
      };
    }

    let stats: any;
    try {
      stats = engine.getStatsSnapshot();
    } catch {
      return {
        success: false,
        type: 'text',
        message: '❌ 获取统计数据失败，引擎可能尚未完全初始化。',
      };
    }

    if (!stats || stats.totalCalls === 0) {
      return {
        success: true,
        type: 'text',
        message:
          '📊 AI Trace 统计数据\n\n暂无录制数据。发起 AI API 调用后将自动记录。',
        data: { stats },
      };
    }

    const lines: string[] = [
      '📊 AI Trace 统计报告',
      '========================',
      '',
      `总调用次数:   ${stats.totalCalls}`,
      `总错误数:     ${stats.totalErrors}`,
      `错误率:       ${stats.totalCalls > 0 ? ((stats.totalErrors / stats.totalCalls) * 100).toFixed(1) : 0}%`,
      '',
      '延迟:',
      `  P50: ${stats.latencyP50?.toFixed(0) || 0}ms`,
      `  P99: ${stats.latencyP99?.toFixed(0) || 0}ms`,
      '',
      'Token 消耗:',
      `  输入 Token:    ${(stats.totalInputTokens || 0).toLocaleString()}`,
      `  输出 Token:    ${(stats.totalOutputTokens || 0).toLocaleString()}`,
      `  缓存读取:      ${(stats.totalCacheReadTokens || 0).toLocaleString()}`,
      `  缓存创建:      ${(stats.totalCacheCreateTokens || 0).toLocaleString()}`,
      '',
    ];

    if (stats.callsByModel && Object.keys(stats.callsByModel).length > 0) {
      lines.push('各模型调用分布:');
      for (const [model, count] of Object.entries(stats.callsByModel)) {
        const errors = stats.errorsByModel?.[model] || 0;
        const avgLatency = stats.avgLatencyByModel?.[model];
        const latencyStr = avgLatency ? `${avgLatency.toFixed(0)}ms` : 'N/A';
        lines.push(
          `  ${model}: ${count} 次调用, ${errors} 错误, 平均 ${latencyStr}`
        );
      }
    }

    return {
      success: true,
      type: 'text',
      message: lines.join('\n'),
      data: { stats },
    };
  },

  /**
   * 导出跟踪数据
   */
  async handleExport(args: string[]): Promise<CommandResult> {
    const engine = getTraceEngine();

    if (!engine) {
      return {
        success: false,
        type: 'text',
        message: '❌ AI Trace 引擎未启动。',
      };
    }

    const format = (args[0] || 'md').toLowerCase();
    const outputDir = args[1]
      ? resolve(args[1])
      : join(resolveOutputDir(), 'traces');

    if (!['md', 'json', 'html'].includes(format)) {
      return {
        success: false,
        type: 'text',
        message: `❌ 不支持的导出格式 "${format}"。支持: md, json, html。`,
      };
    }

    try {
      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }

      const allRecords = engine.getAllRecords() || [];

      if (allRecords.length === 0) {
        return {
          success: true,
          type: 'text',
          message: '⚠️ 没有录制数据可导出。',
        };
      }

      const {
        ExportService,
      } = require('../../../trace-recording/export/ExportService.js');
      const exportService = new ExportService();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const outputFile = join(outputDir, `trace-export-${timestamp}.${format}`);

      await exportService.export(
        allRecords,
        format as 'md' | 'json' | 'html',
        outputFile
      );

      const stat = existsSync(outputFile)
        ? await import('fs').then((m) => m.statSync(outputFile))
        : null;

      return {
        success: true,
        type: 'text',
        message: [
          `✅ 数据导出成功`,
          `  格式: ${format.toUpperCase()}`,
          `  文件: ${outputFile}`,
          `  大小: ${stat ? formatBytes(stat.size) : 'N/A'}`,
          `  记录: ${allRecords.length} 条`,
        ].join('\n'),
        data: { format, outputFile, recordCount: allRecords.length },
      };
    } catch (error) {
      return {
        success: false,
        type: 'text',
        message: `❌ 导出失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },

  /**
   * 生成 HTML 查看器
   */
  handleView(args: string[]): CommandResult {
    const engine = getTraceEngine();

    if (!engine) {
      return {
        success: false,
        type: 'text',
        message: '❌ AI Trace 引擎未启动。',
      };
    }

    try {
      const allRecords = engine.getAllRecords() || [];

      if (allRecords.length === 0) {
        return {
          success: true,
          type: 'text',
          message: '⚠️ 没有录制数据可生成查看器。',
        };
      }

      const outputFile = args[0]
        ? resolve(args[0])
        : join(resolveOutputDir(), 'trace-viewer.html');

      const {
        ViewerService,
      } = require('../../../trace-recording/viewer/ViewerService.js');
      const viewer = new ViewerService();

      if (typeof viewer.generateHtml === 'function') {
        viewer.generateHtml(allRecords, outputFile);
      } else {
        const html = viewer.renderHtml(allRecords);
        writeFileSync(outputFile, html, 'utf-8');
      }

      const stat = existsSync(outputFile)
        ? require('fs').statSync(outputFile)
        : null;

      return {
        success: true,
        type: 'text',
        message: [
          `✅ HTML 查看器已生成`,
          `  文件: ${outputFile}`,
          `  大小: ${stat ? formatBytes(stat.size) : 'N/A'}`,
          `  记录: ${allRecords.length} 条`,
          '',
          `使用浏览器打开该文件即可查看。`,
        ].join('\n'),
        data: { outputFile, recordCount: allRecords.length },
      };
    } catch (error) {
      return {
        success: false,
        type: 'text',
        message: `❌ 生成查看器失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },

  /**
   * 列出录制记录
   */
  handleRecords(args: string[]): CommandResult {
    const engine = getTraceEngine();

    if (!engine) {
      return {
        success: false,
        type: 'text',
        message: '❌ AI Trace 引擎未启动。',
      };
    }

    try {
      const dateFilter = args[0];
      let records: any[];

      if (dateFilter) {
        records = engine.getRecordsByDate(dateFilter) || [];
      } else {
        records = engine.getRecentRecords(20) || [];
      }

      if (records.length === 0) {
        const msg = dateFilter
          ? `📋 ${dateFilter} 没有录制记录`
          : '📋 暂无录制记录';
        return { success: true, type: 'text', message: msg };
      }

      const lines: string[] = [
        `📋 AI Trace 记录列表${dateFilter ? ` (${dateFilter})` : ''}`,
        `共 ${records.length} 条`,
        '',
      ];

      for (const rec of records) {
        const time = rec.timestamp
          ? formatTimestamp(new Date(rec.timestamp))
          : 'N/A';
        const model = rec.model || 'unknown';
        const status = rec.statusCode
          ? rec.statusCode < 400
            ? '✅'
            : rec.statusCode < 500
              ? '⚠️'
              : '❌'
          : rec.error
            ? '❌'
            : '✅';
        const duration = rec.durationMs ? `${rec.durationMs}ms` : 'N/A';
        const tokens = rec.usage
          ? `in:${rec.usage.input_tokens || rec.usage.prompt_tokens || 0} out:${rec.usage.output_tokens || rec.usage.completion_tokens || 0}`
          : '';

        lines.push(`  ${status} ${time} | ${model} | ${duration} | ${tokens}`);
      }

      lines.push('');
      lines.push(`提示: /trace records YYYY-MM-DD 查看特定日期的记录`);

      return {
        success: true,
        type: 'text',
        message: lines.join('\n'),
        data: { records },
      };
    } catch (error) {
      return {
        success: false,
        type: 'text',
        message: `❌ 获取记录列表失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};

export default traceRecordingCommand;
