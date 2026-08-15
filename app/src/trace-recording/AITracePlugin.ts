/**
 * AI Trace 插件
 *
 * 桥接层，统一管理 trace-recording 模块与监控系统的集成。
 * 支持独立模式和集成模式两种运行方式。
 *
 * 独立模式：不依赖监控系统，仅记录 trace 到 JSONL 文件
 * 集成模式：同时向 DashboardDataProvider 推送指标，
 *           关联 OpenTelemetry span，触发告警
 */

import { FetchInterceptor } from './interceptor/FetchInterceptor';
import { TraceEngine } from './engine/TraceEngine';
import { LiveViewServer } from './live/LiveViewServer';
import { ViewerService } from './viewer/ViewerService';
import { ExportService } from './export/ExportService';
import { createLogger, LogLevel } from '@modules/monitoring';
import type {
  TraceRecord,
  TraceConfig,
  PluginStatus,
  ExportFormat,
  MonitoringDeps,
} from './types';

const traceLogger = createLogger({
  module: 'trace-recording',
  level: LogLevel.INFO,
  source: 'llm',
});

/** Trace usage 回调：每次 AI API 调用完成后触发，携带真实 token 消耗 */
export type TraceUsageCallback = (usage: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  durationMs: number;
  status: number;
  timestamp: string;
}) => void;

/** 全局 Trace usage 监听器列表 */
export const traceUsageListeners: TraceUsageCallback[] = [];

/** 默认配置 */
const DEFAULT_CONFIG: TraceConfig = {
  traceDir: 'traces',
  liveViewPort: 0,
  mode: 'all',
  slowThresholdMs: 30000,
};

/**
 * AI Trace 插件
 */
export class AITracePlugin {
  private config: TraceConfig;
  private engine: TraceEngine | null = null;
  private interceptor: FetchInterceptor;
  private liveServer: LiveViewServer | null = null;
  private monitoring: MonitoringDeps | null = null;
  private viewerService: ViewerService;
  private exportService: ExportService;
  private running = false;
  private recordedCount = 0;

  /**
   * @param config 录制配置
   * @param monitoring 监控系统依赖（可选，集成模式时传入）
   */
  constructor(config?: Partial<TraceConfig>, monitoring?: MonitoringDeps) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.interceptor = new FetchInterceptor();
    this.monitoring = monitoring || null;
    this.viewerService = new ViewerService();
    this.exportService = new ExportService();
  }

  /**
   * 启动插件
   *
   * 依次初始化：录制引擎 -> 实时查看服务器 -> 拦截器注册
   */
  start(): void {
    if (this.running) {
      return;
    }

    // 创建录制引擎
    this.engine = new TraceEngine(this.config);

    // 启动实时查看服务器
    if (this.config.liveViewPort > 0) {
      this.liveServer = new LiveViewServer(this.config.liveViewPort);
      this.liveServer.start(this.engine);
    }

    // 注册拦截器
    // v5 方案 3.4（审查 F）：直接返回 promise，使 FetchInterceptor.emitRecord 的
    // catch 生效——此前 `{ this.onRecord(record); }` 无 return，回调返回 undefined，
    // "callback 失败记录日志"保护从未生效。
    this.interceptor.install(this.engine, (record) => this.onRecord(record));

    this.running = true;
  }

  /**
   * 停止插件
   *
   * 逆序关闭：拦截器卸载 -> 查看服务器关闭 -> 引擎关闭
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.interceptor.uninstall();

    if (this.liveServer) {
      this.liveServer.stop();
      this.liveServer = null;
    }

    if (this.engine) {
      await this.engine.close();
    }

    this.running = false;
  }

  /**
   * 处理录制事件
   * 每次有 AI API 调用被录制时触发
   * v5 方案 3.4：按 phase 分流——pending 只写盘 + 索引 + 日志 + 广播；
   * completed 走全链路（recordedCount/stats/usage/metrics/alerts）。
   */
  private async onRecord(record: TraceRecord): Promise<void> {
    const isPending = record.phase === 'pending';

    // v5 方案 3.4（第一轮审查④）：pending 跳过 recordedCount，避免翻倍
    if (!isPending) {
      this.recordedCount++;
    }

    // v5 方案 3.4：traceId 顺序修正——先 pushTracingContext 再 engine.record，
    // 使 traceId/spanId 落盘（此前 engine.record 在 pushTracingContext 之前，从未写入）。
    if (this.monitoring) {
      this.pushTracingContext(record);
    }

    // 写入引擎（pending 时 StatsEngine 内部跳过统计）
    if (this.engine) {
      await this.engine.record(record);
    }

    // === 始终通过 Logger 记录 Trace 数据（必选项，不依赖配置） ===
    const model = this.extractModel(record);
    const usage = this.extractUsageFromRecord(record);
    const isError = !!record.error || record.response.status >= 400;
    // v5 方案 3.4（第四轮审查 C）：pending 用独立事件名，避免日志采集重复计数
    traceLogger.info(isPending ? 'trace:ai_call_pending' : 'trace:ai_call', {
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheCreateTokens: usage.cacheCreateTokens,
      durationMs: record.durationMs,
      status: record.response.status,
      isError,
      timestamp: record.timestamp,
      phase: record.phase,
    });

    // pending 分支：跳过 usage listeners / metrics / alerts（completed 才走全链路）
    if (!isPending) {
      // === 通知全局 usage 监听器（供 UnifiedTokenTracker 校准因子闭环） ===
      if (usage.inputTokens > 0 || usage.outputTokens > 0) {
        for (const listener of traceUsageListeners) {
          try {
            listener({
              model,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              cacheReadTokens: usage.cacheReadTokens,
              cacheCreateTokens: usage.cacheCreateTokens,
              durationMs: record.durationMs,
              status: record.response.status,
              timestamp: record.timestamp,
            });
          } catch {
            // 监听器异常不中断 trace 流程
          }
        }
      }

      // 集成模式：推送指标到监控系统
      if (this.monitoring) {
        this.pushMetrics(record);
        this.checkAlerts(record);
      }
    }

    // 实时广播（pending 也广播——v5 方案 3.6，LiveView 前端按 phase 渲染 ⏳）
    if (this.liveServer) {
      this.liveServer.broadcast(record);
    }
  }

  /**
   * 推送指标到监控仪表板
   */
  private pushMetrics(record: TraceRecord): void {
    const dashboard = this.monitoring?.dashboard;
    if (!dashboard) {
      return;
    }

    const model = this.extractModel(record);
    const labels = { model };
    const isError = !!record.error || record.response.status >= 400;

    dashboard.recordBatch([
      { metric: 'llm.calls.total', value: 1, labels },
      { metric: 'llm.calls.rate', value: 1, labels },
      { metric: 'llm.latency.ms', value: record.durationMs, labels },
      {
        metric: 'llm.tokens.input',
        value: this.extractInputTokens(record),
        labels,
      },
      {
        metric: 'llm.tokens.output',
        value: this.extractOutputTokens(record),
        labels,
      },
      { metric: 'llm.errors.count', value: isError ? 1 : 0, labels },
    ]);
  }

  /**
   * 推送追踪上下文
   * 关联 OpenTelemetry span
   */
  private pushTracingContext(record: TraceRecord): void {
    const tracing = this.monitoring?.tracing;
    if (!tracing) {
      return;
    }

    // 获取当前活跃 span
    const activeSpan = tracing.getActiveSpan?.();
    if (activeSpan) {
      const ctx = activeSpan.spanContext();
      record.traceId = ctx.traceId;
      record.spanId = ctx.spanId;
    }
  }

  /**
   * 检查并触发告警
   */
  private checkAlerts(record: TraceRecord): void {
    const alertManager = this.monitoring?.alertManager;
    if (!alertManager?.sendAlert) {
      return;
    }

    const model = this.extractModel(record);

    // 高延迟告警（>30秒）
    if (record.durationMs > 30000) {
      alertManager.sendAlert({
        title: 'High LLM Latency',
        message: `Model ${model} responded in ${record.durationMs}ms`,
        level: 'warning',
        source: 'ai-trace',
      });
    }

    // 错误告警
    if (record.error || record.response.status >= 400) {
      alertManager.sendAlert({
        title: 'LLM Request Error',
        message: `Model ${model} returned status ${record.response.status}: ${record.error || ''}`,
        level: 'error',
        source: 'ai-trace',
      });
    }
  }

  /**
   * 导出 Trace 记录
   * @param records 记录列表（默认全部）
   * @param format 导出格式
   * @returns 导出内容
   */
  exportRecords(
    records?: TraceRecord[],
    format: ExportFormat = 'markdown'
  ): string {
    const data = records || (this.engine ? this.engine.getAllRecords() : []);
    return this.exportService.export(data, format);
  }

  /**
   * 生成查看器 HTML 文件
   * @param outputPath 输出路径
   * @param records 记录列表（默认全部）
   * @returns 文件路径
   */
  generateViewer(outputPath: string, records?: TraceRecord[]): string {
    const data = records || (this.engine ? this.engine.getAllRecords() : []);
    return this.viewerService.generateHtml(data, outputPath);
  }

  /**
   * 获取插件状态
   */
  getStatus(): PluginStatus {
    return {
      running: this.running,
      mode: this.config.mode,
      recordedCount: this.recordedCount,
      traceDir: this.config.traceDir,
      liveViewUrl: this.liveServer?.running
        ? this.liveServer.getUrl()
        : undefined,
    };
  }

  /**
   * 获取统计快照
   */
  getStats() {
    return this.engine?.getStatsSnapshot() || null;
  }

  /**
   * 获取录制引擎
   */
  getEngine(): TraceEngine | null {
    return this.engine;
  }

  /**
   * 从记录中提取模型名
   */
  private extractModel(record: TraceRecord): string {
    const body = record.request.body;
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const m = (body as Record<string, unknown>).model;
      if (typeof m === 'string') {
        return m;
      }
    }
    return 'unknown';
  }

  /**
   * 从 TraceRecord 中提取完整 token 用量（兼容 Anthropic / OpenAI / Gemini 格式）
   */
  private extractUsageFromRecord(record: TraceRecord): {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreateTokens: number;
  } {
    const body = record.response.body;
    if (body && typeof body === 'object') {
      const resp = body as Record<string, unknown>;
      const usage = resp.usage as Record<string, unknown> | undefined;
      if (usage) {
        return {
          inputTokens:
            (usage.input_tokens as number) ||
            (usage.prompt_tokens as number) ||
            0,
          outputTokens:
            (usage.output_tokens as number) ||
            (usage.completion_tokens as number) ||
            0,
          cacheReadTokens: (usage.cache_read_input_tokens as number) || 0,
          cacheCreateTokens: (usage.cache_creation_input_tokens as number) || 0,
        };
      }
      // Gemini: usageMetadata
      const um = resp.usageMetadata as Record<string, number> | undefined;
      if (um && typeof um.promptTokenCount === 'number') {
        return {
          inputTokens: um.promptTokenCount,
          outputTokens: um.candidatesTokenCount ?? 0,
          cacheReadTokens: 0,
          cacheCreateTokens: 0,
        };
      }
    }
    return {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
    };
  }

  /**
   * 提取输入 token（兼容旧接口）
   */
  private extractInputTokens(record: TraceRecord): number {
    return this.extractUsageFromRecord(record).inputTokens;
  }

  /**
   * 提取输出 token（兼容旧接口）
   */
  private extractOutputTokens(record: TraceRecord): number {
    return this.extractUsageFromRecord(record).outputTokens;
  }
}
