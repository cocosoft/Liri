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
export { SSEReassembler } from './sse/index';

// 引擎层
export { TraceEngine, TraceWriter, TraceStore, StatsEngine } from './engine/index';
export type { WriterStats } from './engine/index';

// 查看层
export { ViewerService } from './viewer/index';

// 实时层
export { LiveViewServer } from './live/index';

// 导出层
export { ExportService } from './export/index';

// 插件层
export { AITracePlugin } from './AITracePlugin';

// 本地导入（供工厂函数使用）
import { AITracePlugin } from './AITracePlugin';
import type { MonitoringDeps, TraceConfig } from './types';

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
 * 创建并启动 AITracePlugin
 *
 * 从环境变量读取配置：
 *   - AI_TRACE_DIR: 录制文件目录（默认: traces）
 *   - AI_TRACE_MODE: 录制模式 all|error-only|slow-only（默认: all）
 *   - AI_TRACE_SLOW_THRESHOLD: 慢请求阈值毫秒（默认: 30000）
 *   - AI_TRACE_LIVE_VIEW_PORT: 实时查看端口（0=禁用，默认: 0）
 *
 * @param deps 监控系统依赖（可选，传参启用集成模式）
 */
export function createAITracePlugin(
  deps?: MonitoringDeps
): AITracePlugin {
  if (globalPlugin) {
    return globalPlugin;
  }

  const config: TraceConfig = {
    traceDir: process.env.AI_TRACE_DIR || 'traces',
    mode: (process.env.AI_TRACE_MODE as TraceConfig['mode']) || 'all',
    slowThresholdMs: Number(process.env.AI_TRACE_SLOW_THRESHOLD) || 30000,
    liveViewPort: Number(process.env.AI_TRACE_LIVE_VIEW_PORT) || 0,
  };

  globalPlugin = new AITracePlugin(config, deps || undefined);
  globalPlugin.start();

  return globalPlugin;
}
