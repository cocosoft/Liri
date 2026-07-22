/**
 * SpanCollector — 内存 Span 收集器
 *
 * 实现 OpenTelemetry SpanExporter 接口，将 Span 存入环形缓冲区，
 * 供前端 UI 组件实时展示追踪数据。
 *
 * 缓冲区上限 200 条，超限自动丢弃最旧记录。
 */

import type { SpanExporter } from "@opentelemetry/sdk-trace-web";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-web";
import type { ExportResult } from "@opentelemetry/core";

export type SpanKind =
  "internal" | "server" | "client" | "producer" | "consumer";

const SPAN_KIND_MAP: Record<number, SpanKind> = {
  1: "internal",
  2: "server",
  3: "client",
  4: "producer",
  5: "consumer",
};

/** 从 Span 中提取的 UI 友好摘要 */
export interface SpanRecord {
  id: string;
  traceId: string;
  parentSpanId?: string;
  name: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  status: "ok" | "error" | "unset";
  spanKind?: SpanKind;
  attributes: Record<string, unknown>;
  errorMessage?: string;
  links?: { traceId: string; spanId: string }[];
}

const MAX_SPANS = 200;

/** Span 环形缓冲区 */
const spanBuffer: SpanRecord[] = [];

/** 订阅者：每次新 Span 到达时通知 UI 刷新 */
type SpanListener = () => void;
const listeners: Set<SpanListener> = new Set();

export function subscribeSpanCollector(fn: SpanListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notifyListeners(): void {
  listeners.forEach((fn) => fn());
}

/** 将 ReadableSpan 转为 SpanRecord */
function toSpanRecord(span: ReadableSpan): SpanRecord {
  const attrs: Record<string, unknown> = {};
  const attrObj = span.attributes as Record<string, unknown>;
  for (const key of Object.keys(attrObj)) {
    attrs[key] = attrObj[key];
  }

  const durationMs =
    span.endTime[0] * 1000 +
    span.endTime[1] / 1e6 -
    (span.startTime[0] * 1000 + span.startTime[1] / 1e6);

  let status: SpanRecord["status"] = "unset";
  let errorMessage: string | undefined;
  if (span.status.code === 2) {
    // ERROR
    status = "error";
    errorMessage = attrs["error.message"] as string | undefined;
  } else if (span.status.code === 1) {
    // OK
    status = "ok";
  }

  return {
    id: span.spanContext().spanId,
    traceId: span.spanContext().traceId,
    parentSpanId: (span as { parentSpanId?: string }).parentSpanId || undefined,
    name: span.name,
    startTime: span.startTime[0] * 1000 + span.startTime[1] / 1e6,
    endTime: span.endTime[0] * 1000 + span.endTime[1] / 1e6,
    durationMs: Math.round(durationMs * 100) / 100,
    status,
    spanKind: span.kind ? SPAN_KIND_MAP[span.kind] : undefined,
    attributes: attrs,
    errorMessage,
    links: span.links?.map((l) => ({
      traceId: l.context.traceId,
      spanId: l.context.spanId,
    })),
  };
}

/**
 * 获取当前缓冲区中所有 Span（最新在前）
 */
export function getSpanRecords(): SpanRecord[] {
  return [...spanBuffer].reverse();
}

/**
 * 清空缓冲区
 */
export function clearSpanRecords(): void {
  spanBuffer.length = 0;
  notifyListeners();
}

/**
 * SpanCollector — 实现 SpanExporter，将 Span 同步写入内存缓冲区
 */
export class SpanCollector implements SpanExporter {
  export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void,
  ): void {
    for (const span of spans) {
      const record = toSpanRecord(span);
      spanBuffer.push(record);
      if (spanBuffer.length > MAX_SPANS) {
        spanBuffer.shift();
      }
    }
    resultCallback({ code: 0 }); // SUCCESS
    notifyListeners();
  }

  async shutdown(): Promise<void> {
    spanBuffer.length = 0;
    notifyListeners();
  }
}
