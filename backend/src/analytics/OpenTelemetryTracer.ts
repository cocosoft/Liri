import { AsyncLocalStorage } from 'async_hooks'

export interface SpanContext {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  startTime: bigint
  endTime?: bigint
  attributes: Record<string, string | number | boolean>
  events: Array<{ name: string; timestamp: bigint; attributes: Record<string, string | number | boolean> }>
  status: { code: 0 | 1 | 2; message?: string }
  kind: 'server' | 'client' | 'producer' | 'consumer' | 'internal'
}

export interface TracerConfig {
  serviceName: string
  serviceVersion: string
  samplingRate: number
  exporterEndpoint?: string
  enabled: boolean
}

export class OpenTelemetryTracer {
  private storage: AsyncLocalStorage<SpanContext>
  private spans: Map<string, SpanContext> = new Map()
  private config: TracerConfig
  private initialized: boolean = false

  constructor(config?: Partial<TracerConfig>) {
    this.storage = new AsyncLocalStorage()
    this.config = {
      serviceName: config?.serviceName || 'py_app',
      serviceVersion: config?.serviceVersion || '1.0.0',
      samplingRate: config?.samplingRate ?? 1.0,
      exporterEndpoint: config?.exporterEndpoint,
      enabled: config?.enabled !== false,
    }
  }

  async initialize(): Promise<void> {
    if (!this.config.enabled) return
    this.initialized = true
  }

  private generateId(): string {
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`
  }

  private shouldSample(): boolean {
    return Math.random() < this.config.samplingRate
  }

  startSpan(name: string, options?: {
    parentSpanId?: string
    attributes?: Record<string, string | number | boolean>
    kind?: SpanContext['kind']
  }): SpanContext {
    const spanId = this.generateId()
    const traceId = this.storage.getStore()?.traceId || this.generateId()

    const span: SpanContext = {
      traceId,
      spanId,
      parentSpanId: options?.parentSpanId,
      name,
      startTime: process.hrtime.bigint(),
      attributes: {
        ...this.defaultAttributes(),
        ...options?.attributes,
      },
      events: [],
      status: { code: 0 },
      kind: options?.kind || 'internal',
    }

    this.spans.set(spanId, span)
    return span
  }

  endSpan(spanId: string, status?: { code: 0 | 1 | 2; message?: string }): SpanContext | undefined {
    const span = this.spans.get(spanId)
    if (!span) return undefined

    span.endTime = process.hrtime.bigint()
    if (status) {
      span.status = status
    }

    this.exportSpan(span)
    return span
  }

  addEvent(spanId: string, name: string, attributes?: Record<string, string | number | boolean>): void {
    const span = this.spans.get(spanId)
    if (!span) return

    span.events.push({
      name,
      timestamp: process.hrtime.bigint(),
      attributes: attributes || {},
    })
  }

  setAttribute(spanId: string, key: string, value: string | number | boolean): void {
    const span = this.spans.get(spanId)
    if (span) {
      span.attributes[key] = value
    }
  }

  runInSpan<T>(span: SpanContext, fn: () => T): T {
    return this.storage.run(span, fn)
  }

  getActiveSpan(): SpanContext | undefined {
    return this.storage.getStore()
  }

  private defaultAttributes(): Record<string, string | number | boolean> {
    return {
      'service.name': this.config.serviceName,
      'service.version': this.config.serviceVersion,
      'process.pid': process.pid,
      'host.name': process.env.HOSTNAME || process.env.COMPUTERNAME || 'unknown',
    }
  }

  getSpanDurationMs(spanId: string): number {
    const span = this.spans.get(spanId)
    if (!span || !span.endTime) return 0

    const durationNs = Number(span.endTime - span.startTime)
    return durationNs / 1_000_000
  }

  getTraceSummary(traceId: string): {
    spanCount: number
    totalDurationMs: number
    errors: number
  } {
    const traceSpans = Array.from(this.spans.values())
      .filter(s => s.traceId === traceId)

    let totalDurationNs = 0n
    let errors = 0

    for (const span of traceSpans) {
      if (span.endTime) {
        totalDurationNs += (span.endTime - span.startTime)
      }
      if (span.status.code !== 0) {
        errors++
      }
    }

    return {
      spanCount: traceSpans.length,
      totalDurationMs: Number(totalDurationNs) / 1_000_000,
      errors,
    }
  }

  private exportSpan(span: SpanContext): void {
    if (this.config.exporterEndpoint) {
      const payload = {
        resourceSpans: [{
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: this.config.serviceName } },
              { key: 'service.version', value: { stringValue: this.config.serviceVersion } },
            ],
          },
          scopeSpans: [{
            spans: [{
              traceId: span.traceId,
              spanId: span.spanId,
              parentSpanId: span.parentSpanId || '',
              name: span.name,
              startTimeUnixNano: String(span.startTime),
              endTimeUnixNano: span.endTime ? String(span.endTime) : String(span.startTime),
              attributes: Object.entries(span.attributes).map(([k, v]) => ({
                key: k,
                value: typeof v === 'string' ? { stringValue: v }
                  : typeof v === 'number' ? (Number.isInteger(v) ? { intValue: v } : { doubleValue: v })
                  : { boolValue: v },
              })),
              status: {
                code: span.status.code,
                message: span.status.message,
              },
            }],
          }],
        }],
      }

      fetch(this.config.exporterEndpoint + '/v1/traces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {})
    }
  }

  destroy(): void {
    this.spans.clear()
    this.initialized = false
  }
}

export function createTracer(config?: Partial<TracerConfig>): OpenTelemetryTracer {
  return new OpenTelemetryTracer(config)
}
