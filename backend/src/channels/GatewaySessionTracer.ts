/**
 * SessionTracing 网关层适配器
 * 对标平安科技：将 Session Span 打通到 Gateway 层
 * 端到端追踪消息从入站到出站
 */
import {
  getSessionSpanTracer,
  SPAN_ATTRIBUTE_KEYS,
  type SessionSpanContext,
  type SessionSpanAttributes,
} from '../ai/telemetry/SessionSpanTracer';
import type { ChannelId, MessageContext } from './types/IChannel';

/**
 * 网关追踪配置
 */
export interface GatewayTraceConfig {
  enabled: boolean;
  traceInboundMessages: boolean;
  traceOutboundMessages: boolean;
  traceAgentExecution: boolean;
  traceToolExecution: boolean;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: GatewayTraceConfig = {
  enabled: true,
  traceInboundMessages: true,
  traceOutboundMessages: true,
  traceAgentExecution: true,
  traceToolExecution: true,
};

/**
 * 网关消息追踪记录
 */
export interface GatewayTraceRecord {
  traceId: string;
  spanId: string;
  phase: 'inbound' | 'processing' | 'agent' | 'tool' | 'outbound';
  channelId?: ChannelId;
  messageId?: string;
  contentLength: number;
  startTime: number;
  endTime: number | null;
  status: 'ok' | 'error';
  error?: string;
}

/**
 * Gateway Session 追踪器
 */
export class GatewaySessionTracer {
  private config: GatewayTraceConfig;
  private traceRecords: GatewayTraceRecord[] = [];
  private maxRecords: number = 1000;

  constructor(config?: Partial<GatewayTraceConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 追踪入站消息
   * @param context 消息上下文
   * @param contentLength 内容长度
   * @returns Span 上下文 + 追踪记录
   */
  traceInbound(
    context: MessageContext,
    contentLength: number
  ): { spanContext: SessionSpanContext; record: GatewayTraceRecord } {
    const tracer = getSessionSpanTracer();

    if (!this.config.enabled || !this.config.traceInboundMessages) {
      const emptyContext: SessionSpanContext = {
        traceId: '',
        spanId: '',
        isSampled: false,
      };

      return {
        spanContext: emptyContext,
        record: {
          traceId: '',
          spanId: '',
          phase: 'inbound',
          channelId: context.channelId,
          messageId: context.messageId,
          contentLength,
          startTime: Date.now(),
          endTime: null,
          status: 'ok',
        },
      };
    }

    const attributes: SessionSpanAttributes = {
      channel: context.channelId,
      platform: context.channelId,
    };

    const spanContext = tracer.startSpan('gateway.inbound', attributes);

    tracer.setAttribute(
      spanContext,
      SPAN_ATTRIBUTE_KEYS.CHANNEL,
      context.channelId
    );

    const record: GatewayTraceRecord = {
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
      phase: 'inbound',
      channelId: context.channelId,
      messageId: context.messageId,
      contentLength,
      startTime: Date.now(),
      endTime: null,
      status: 'ok',
    };

    this.addRecord(record);

    return { spanContext, record };
  }

  /**
   * 追踪 Agent 处理阶段
   * @param parentContext 父 Span 上下文
   * @param model 模型名
   * @param agentName Agent 名
   * @returns Agent Span 上下文
   */
  traceAgentPhase(
    parentContext: SessionSpanContext,
    model: string,
    agentName?: string
  ): SessionSpanContext {
    if (
      !this.config.enabled ||
      !parentContext.isSampled ||
      !this.config.traceAgentExecution
    ) {
      return parentContext;
    }

    const tracer = getSessionSpanTracer();
    const attributes: SessionSpanAttributes = {
      model,
      agent: agentName || 'default',
    };

    const spanContext = tracer.startChildSpan(
      'gateway.agent.execute',
      parentContext,
      attributes
    );

    tracer.setAttribute(spanContext, SPAN_ATTRIBUTE_KEYS.MODEL, model);
    if (agentName) {
      tracer.setAttribute(spanContext, SPAN_ATTRIBUTE_KEYS.AGENT, agentName);
    }

    return spanContext;
  }

  /**
   * 追踪工具执行阶段
   * @param parentContext 父 Span 上下文
   * @param toolName 工具名
   * @returns Tool Span 上下文
   */
  traceToolPhase(
    parentContext: SessionSpanContext,
    toolName: string
  ): SessionSpanContext {
    if (
      !this.config.enabled ||
      !parentContext.isSampled ||
      !this.config.traceToolExecution
    ) {
      return parentContext;
    }

    const tracer = getSessionSpanTracer();
    const attributes: SessionSpanAttributes = {};

    const spanContext = tracer.startChildSpan(
      `gateway.tool.${toolName}`,
      parentContext,
      attributes
    );

    tracer.addEvent(spanContext, 'tool_started', { tool: toolName });

    return spanContext;
  }

  /**
   * 追踪出站消息
   * @param parentContext 父 Span 上下文
   * @param channelId 渠道 ID
   * @param contentLength 内容长度
   */
  traceOutbound(
    parentContext: SessionSpanContext,
    channelId: ChannelId,
    contentLength: number
  ): void {
    if (
      !this.config.enabled ||
      !parentContext.isSampled ||
      !this.config.traceOutboundMessages
    ) {
      return;
    }

    const tracer = getSessionSpanTracer();
    const attributes: SessionSpanAttributes = {
      channel: channelId,
    };

    const spanContext = tracer.startChildSpan(
      'gateway.outbound',
      parentContext,
      attributes
    );

    tracer.setAttribute(spanContext, SPAN_ATTRIBUTE_KEYS.CHANNEL, channelId);
    tracer.setAttribute(
      spanContext,
      SPAN_ATTRIBUTE_KEYS.OUTPUT_TOKENS,
      contentLength
    );
    tracer.endSpan(spanContext, 'ok');

    const record: GatewayTraceRecord = {
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
      phase: 'outbound',
      channelId,
      contentLength,
      startTime: Date.now(),
      endTime: Date.now(),
      status: 'ok',
    };

    this.addRecord(record);
  }

  /**
   * 结束入站追踪 Span
   * @param spanContext Span 上下文
   * @param error 错误信息
   */
  endInboundTrace(spanContext: SessionSpanContext, error?: string): void {
    if (!this.config.enabled || !spanContext.isSampled) return;

    const tracer = getSessionSpanTracer();

    if (error) {
      tracer.endSpan(spanContext, 'error', error);
    } else {
      tracer.endSpan(spanContext, 'ok');
    }

    const record = this.traceRecords.find(
      (r) => r.spanId === spanContext.spanId
    );
    if (record) {
      record.endTime = Date.now();
      record.status = error ? 'error' : 'ok';
      record.error = error;
    }
  }

  /**
   * 获取端到端延迟统计
   * @returns 延迟统计
   */
  getLatencyStats(): {
    avgInboundMs: number;
    avgProcessingMs: number;
    avgOutboundMs: number;
    avgTotalMs: number;
  } {
    const inboundRecords = this.traceRecords.filter(
      (r) => r.phase === 'inbound' && r.endTime
    );
    const outboundRecords = this.traceRecords.filter(
      (r) => r.phase === 'outbound' && r.endTime
    );

    const avgInbound =
      inboundRecords.length > 0
        ? inboundRecords.reduce((s, r) => s + (r.endTime! - r.startTime), 0) /
          inboundRecords.length
        : 0;

    const avgOutbound =
      outboundRecords.length > 0
        ? outboundRecords.reduce((s, r) => s + (r.endTime! - r.startTime), 0) /
          outboundRecords.length
        : 0;

    return {
      avgInboundMs: Math.round(avgInbound),
      avgProcessingMs: 0,
      avgOutboundMs: Math.round(avgOutbound),
      avgTotalMs: Math.round(avgInbound + avgOutbound),
    };
  }

  /**
   * 获取追踪记录
   */
  getRecords(limit?: number): GatewayTraceRecord[] {
    const sorted = [...this.traceRecords].sort(
      (a, b) => b.startTime - a.startTime
    );

    return limit ? sorted.slice(0, limit) : sorted;
  }

  /**
   * 添加记录
   */
  private addRecord(record: GatewayTraceRecord): void {
    this.traceRecords.push(record);

    if (this.traceRecords.length > this.maxRecords) {
      this.traceRecords = this.traceRecords.slice(-this.maxRecords);
    }
  }

  /**
   * 清除记录
   */
  clear(): void {
    this.traceRecords = [];
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<GatewayTraceConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * 全局 Gateway 追踪器
 */
let globalGatewayTracer: GatewaySessionTracer | null = null;

/**
 * 获取全局 Gateway Session 追踪器
 */
export function getGatewaySessionTracer(): GatewaySessionTracer {
  if (!globalGatewayTracer) {
    globalGatewayTracer = new GatewaySessionTracer();
  }

  return globalGatewayTracer;
}
