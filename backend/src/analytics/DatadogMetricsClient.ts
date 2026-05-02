export interface DatadogConfig {
  apiKey: string
  appKey: string
  site: string
  serviceName: string
  env: string
  version: string
  enabled: boolean
  flushInterval: number
  batchSize: number
}

export const DEFAULT_DATADOG_CONFIG: DatadogConfig = {
  apiKey: process.env.DD_API_KEY || '',
  appKey: process.env.DD_APP_KEY || '',
  site: process.env.DD_SITE || 'datadoghq.com',
  serviceName: process.env.DD_SERVICE || 'py_app',
  env: process.env.DD_ENV || 'production',
  version: process.env.DD_VERSION || '1.0.0',
  enabled: process.env.DD_ENABLED === 'true' || !!process.env.DD_API_KEY,
  flushInterval: parseInt(process.env.DD_FLUSH_INTERVAL || '10000', 10),
  batchSize: parseInt(process.env.DD_BATCH_SIZE || '100', 10),
}

export interface DatadogMetric {
  name: string
  value: number
  type: 'gauge' | 'count' | 'rate' | 'histogram'
  tags: string[]
  timestamp: number
}

export interface DatadogEvent {
  title: string
  text: string
  alertType: 'info' | 'warning' | 'error' | 'success'
  tags: string[]
  timestamp: number
}

export interface DatadogServiceCheck {
  name: string
  status: 0 | 1 | 2 | 3
  hostname?: string
  tags: string[]
  message?: string
  timestamp: number
}

export class DatadogMetricsClient {
  private config: DatadogConfig
  private metrics: DatadogMetric[] = []
  private events: DatadogEvent[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private initialized: boolean = false
  private hostname: string

  constructor(config?: Partial<DatadogConfig>) {
    this.config = { ...DEFAULT_DATADOG_CONFIG, ...config }
    this.hostname = process.env.HOSTNAME || process.env.COMPUTERNAME || 'unknown'
  }

  get isEnabled(): boolean {
    return this.config.enabled && !!this.config.apiKey
  }

  async initialize(): Promise<void> {
    if (!this.isEnabled) return
    this.initialized = true
    this.startFlushTimer()
  }

  gauge(name: string, value: number, tags: string[] = []): void {
    if (!this.isEnabled) return
    this.metrics.push({
      name,
      value,
      type: 'gauge',
      tags: [...this.defaultTags(), ...tags],
      timestamp: Date.now() / 1000,
    })
    this.checkFlush()
  }

  count(name: string, value: number = 1, tags: string[] = []): void {
    if (!this.isEnabled) return
    this.metrics.push({
      name,
      value,
      type: 'count',
      tags: [...this.defaultTags(), ...tags],
      timestamp: Date.now() / 1000,
    })
    this.checkFlush()
  }

  histogram(name: string, value: number, tags: string[] = []): void {
    if (!this.isEnabled) return
    this.metrics.push({
      name,
      value,
      type: 'histogram',
      tags: [...this.defaultTags(), ...tags],
      timestamp: Date.now() / 1000,
    })
    this.checkFlush()
  }

  sendEvent(event: Omit<DatadogEvent, 'timestamp'>): void {
    if (!this.isEnabled) return
    this.events.push({
      ...event,
      tags: [...this.defaultTags(), ...event.tags],
      timestamp: Date.now() / 1000,
    })
  }

  async sendServiceCheck(check: Omit<DatadogServiceCheck, 'timestamp'>): Promise<void> {
    if (!this.isEnabled) return

    const serviceCheck: DatadogServiceCheck = {
      ...check,
      hostname: check.hostname || this.hostname,
      tags: [...this.defaultTags(), ...check.tags],
      timestamp: Date.now() / 1000,
    }

    try {
      await this.postToDatadog('/api/v1/check_run', [serviceCheck])
    } catch (error) {
      console.error('[Datadog] Service check failed:', error)
    }
  }

  private defaultTags(): string[] {
    return [
      `service:${this.config.serviceName}`,
      `env:${this.config.env}`,
      `version:${this.config.version}`,
      `host:${this.hostname}`,
    ]
  }

  private checkFlush(): void {
    if (this.metrics.length >= this.config.batchSize) {
      this.flush()
    }
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flush()
    }, this.config.flushInterval)
  }

  async flush(): Promise<void> {
    if (!this.isEnabled || (this.metrics.length === 0 && this.events.length === 0)) return

    const metricsToSend = this.metrics.splice(0)
    const eventsToSend = this.events.splice(0)

    const promises: Promise<void>[] = []

    if (metricsToSend.length > 0) {
      promises.push(
        this.postToDatadog('/api/v1/series', { series: metricsToSend })
      )
    }

    if (eventsToSend.length > 0) {
      promises.push(
        this.postToDatadog('/api/v1/events', eventsToSend)
      )
    }

    await Promise.allSettled(promises)
  }

  private async postToDatadog(endpoint: string, body: unknown): Promise<void> {
    const url = `https://api.${this.config.site}${endpoint}`

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000)

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'DD-API-KEY': this.config.apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        console.warn(`[Datadog] HTTP ${response.status}: ${await response.text().catch(() => '')}`)
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        console.warn('[Datadog] Request timeout')
      } else {
        console.error('[Datadog] Post error:', error)
      }
    }
  }

  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    this.flush()
    this.metrics = []
    this.events = []
    this.initialized = false
  }
}

export function getDatadogClient(config?: Partial<DatadogConfig>): DatadogMetricsClient {
  return new DatadogMetricsClient(config)
}
