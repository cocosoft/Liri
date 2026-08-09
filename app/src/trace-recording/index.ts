// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * ai-trace 模块入口
 *
 * AI API 调用录制与追踪模块。
 * 通过拦截全局 fetch 自动录制 AI API 流量，支持：
 *
 * - 自动录制：零代码入侵，通过 URL 模式匹配 AI API 域名
 * - SSE 重组：支持 Anthropic Messages API / OpenAI Responses API / Chat Completions
 * - JSONL 存储：按日轮换文件，支持历史查询
 * - 实时查看：基于 SSE 的实时推送，内置 HTML 查看器
 * - 多格式导出：Markdown / JSON / HTML
 * - 监控集成：可选推送指标到 DashboardDataProvider，关联 SessionTracing span
 *
 * @module
 */

import { configManager } from '@modules/config';

// 核心类型
export type {
  TraceRecord,
  SSERawEvent,
  TraceConfig,
  StatsSnapshot,
  PluginStatus,
  ExportFormat,
  MonitoringDeps,
} from './types';

// 拦截层
export {
  FetchInterceptor,
  isAIApiUrl,
  sanitizeHeaders,
  filterHopByHopHeaders,
  extractModelName,
} from './interceptor/index';

// SSE 重组层
export { SSEReassembler } from './sse/SSEReassembler';

// 引擎层
export {
  TraceEngine,
  TraceWriter,
  TraceStore,
  StatsEngine,
} from './engine/index';
export type { WriterStats } from './engine/index';

// 查看层
export { ViewerService } from './viewer/ViewerService';

// 实时层
export { LiveViewServer } from './live/LiveViewServer';

// 导出层
export { ExportService } from './export/ExportService';

// 插件层
export { AITracePlugin } from './AITracePlugin';

// 本地导入（供工厂函数使用）
import { AITracePlugin } from './AITracePlugin';
import type { MonitoringDeps, TraceConfig } from './types';

/** createAITracePlugin 配置参数 */
export interface AITracePluginOptions {
  /** 录制存储目录（优先级高于环境变量 AI_TRACE_DIR） */
  traceDir?: string;
  /** 监控系统依赖（用于集成模式） */
  deps?: {
    /** OTel Tracer 实例（用于关联 Span） */
    otel?: unknown;
    /** Logger 实例 */
    logger?: unknown;
  };
}

/**
 * 全局 AITracePlugin 实例
 */
let globalPlugin: AITracePlugin | null = null;

/**
 * 获取全局 AITracePlugin 实例
 */
export function getAITracePlugin(): AITracePlugin | null {
  return globalPlugin;
}

/**
 * 创建并启动 AITracePlugin（始终启用，不可配置关闭）
 *
 * 从环境变量读取配置（options 参数优先级更高）：
 *   - AI_TRACE_DIR: 录制文件目录（默认: traces）
 *   - AI_TRACE_MODE: 录制模式 all|error-only|slow-only（默认: all）
 *   - AI_TRACE_SLOW_THRESHOLD: 慢请求阈值毫秒（默认: 30000）
 *   - AI_TRACE_LIVE_VIEW_PORT: 实时查看端口（0=禁用，默认: 0）
 *
 * Trace 是必选基础设施，用于记录真实 token 消耗、校准估算偏差、
 * 驱动压缩决策和成本计算。不再支持 DISABLE_TRACE_RECORDING 环境变量关闭。
 *
 * @param options 可选的配置覆盖 + 监控系统依赖
 */
export function createAITracePlugin(
  options?: AITracePluginOptions
): AITracePlugin {
  if (globalPlugin) {
    return globalPlugin;
  }

  const traceDir =
    options?.traceDir || configManager.env('AI_TRACE_DIR') || 'traces';

  const config: TraceConfig = {
    traceDir,
    mode: (configManager.env('AI_TRACE_MODE') as TraceConfig['mode']) || 'all',
    slowThresholdMs:
      Number(configManager.env('AI_TRACE_SLOW_THRESHOLD')) || 30000,
    liveViewPort: Number(configManager.env('AI_TRACE_LIVE_VIEW_PORT')) || 0,
  };

  // 将新的 deps 格式映射到 MonitoringDeps
  let monitoring: MonitoringDeps | undefined;
  if (options?.deps) {
    monitoring = {};
    if (
      options.deps.otel &&
      typeof (options.deps.otel as Record<string, unknown>).getActiveSpan ===
        'function'
    ) {
      monitoring.tracing = {
        getActiveSpan: (options.deps.otel as Record<string, unknown>)
          .getActiveSpan as () =>
          | { spanContext: () => { traceId: string; spanId: string } }
          | undefined,
      };
    }
  }

  globalPlugin = new AITracePlugin(config, monitoring);
  // Trace 始终启动（必选项）
  globalPlugin.start();

  return globalPlugin;
}
