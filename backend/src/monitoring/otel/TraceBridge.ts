/**
 * 追踪桥接器
 * 将应用层自定义追踪数据映射到 OTel 标准追踪的桥接层
 */

import { SpanStatusCode, Span } from '@opentelemetry/api';
import { OTelTracing } from './OTelTracing.js';
import { errorMessage } from '@modules/utils/errors.js';

export interface TraceEvent {
  name: string;
  startTime: number;
  endTime?: number;
  attributes?: Record<string, string | number | boolean>;
  status?: 'ok' | 'error';
  errorMessage?: string;
  parentSpanId?: string;
}

export interface TraceBridgeStats {
  totalSpans: number;
  activeSpans: number;
  errors: string[];
}

export class TraceBridge {
  private otelTracing: OTelTracing;
  private errorList: string[] = [];

  constructor(otelTracing: OTelTracing) {
    this.otelTracing = otelTracing;
  }

  createSpan(event: TraceEvent): Span | undefined {
    try {
      const span = this.otelTracing.startSpan(
        event.name,
        event.attributes || {}
      );

      if (event.startTime > 0) {
        (span as any).setStartTime(event.startTime * 1000000);
      }

      return span;
    } catch (err) {
      this.errorList.push(`createSpan ${event.name}: ${errorMessage(err)}`);
      return undefined;
    }
  }

  endSpan(span: Span, event: TraceEvent): void {
    try {
      if (event.status === 'error') {
        this.otelTracing.endSpan(
          span,
          SpanStatusCode.ERROR,
          event.errorMessage || ''
        );
      } else {
        this.otelTracing.endSpan(span, SpanStatusCode.OK);
      }
    } catch (err) {
      this.errorList.push(`endSpan ${event.name}: ${errorMessage(err)}`);
    }
  }

  recordEvent(event: TraceEvent): void {
    const span = this.createSpan(event);
    if (span) {
      this.endSpan(span, event);
    }
  }

  recordEvents(events: TraceEvent[]): void {
    for (const event of events) {
      this.recordEvent(event);
    }
  }

  getStats(): TraceBridgeStats {
    return {
      totalSpans: this.otelTracing.getActiveSpans().size,
      activeSpans: this.otelTracing.getActiveSpans().size,
      errors: [...this.errorList],
    };
  }
}

export function createTraceBridge(otelTracing: OTelTracing): TraceBridge {
  return new TraceBridge(otelTracing);
}
