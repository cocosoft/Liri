//
/**
 * 遥测工具
 *
 * 提供遥测数据收集和上报功能。
 * 包含用户许可检查、事件采样和批量上报。
 */
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { randomUUID } from 'crypto'

export type TelemetryLevel = 'off' | 'basic' | 'full'

export interface TelemetryEvent {
  id: string
  name: string
  timestamp: string
  properties: Record<string, string | number | boolean | undefined>
  level: TelemetryLevel
}

const TELEMETRY_DIR = join(homedir(), '.py_app', 'telemetry')
const CONSENT_FILE = join(TELEMETRY_DIR, '.consent')
const EVENTS_FILE = join(TELEMETRY_DIR, 'events.jsonl')
const MAX_BATCH_SIZE = 50
const FLUSH_INTERVAL_MS = 60000

export class TelemetryService {
  private level: TelemetryLevel = 'off'
  private events: TelemetryEvent[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private userId: string = ''

  constructor() {
    this.loadConsent()
    this.userId = this.getOrCreateUserId()
  }

  private getOrCreateUserId(): string {
    const userIdFile = join(TELEMETRY_DIR, '.user_id')
    try {
      if (existsSync(userIdFile)) {
        return readFile(userIdFile, 'utf-8')
      }
    } catch {
      // 读取失败则创建新 ID
    }
    const id = randomUUID()
    if (!existsSync(TELEMETRY_DIR)) {
      mkdir(TELEMETRY_DIR, { recursive: true })
    }
    writeFile(userIdFile, id, 'utf-8')
    return id
  }

  private loadConsent(): void {
    try {
      if (existsSync(CONSENT_FILE)) {
        const data = readFile(CONSENT_FILE, 'utf-8')
        this.level = data.trim() as TelemetryLevel
      } else {
        this.level = process.env.PY_APP_TELEMETRY_LEVEL as TelemetryLevel || 'basic'
      }
    } catch {
      this.level = 'basic'
    }
  }

  async setConsent(level: TelemetryLevel): Promise<void> {
    this.level = level
    if (!existsSync(TELEMETRY_DIR)) {
      await mkdir(TELEMETRY_DIR, { recursive: true })
    }
    await writeFile(CONSENT_FILE, level, 'utf-8')
  }

  getLevel(): TelemetryLevel {
    return this.level
  }

  track(name: string, properties?: Record<string, string | number | boolean | undefined>, level?: TelemetryLevel): void {
    const eventLevel = level || 'basic'

    if (this.level === 'off') return
    if (this.level === 'basic' && eventLevel === 'full') return

    const event: TelemetryEvent = {
      id: randomUUID(),
      name,
      timestamp: new Date().toISOString(),
      properties: properties || {},
      level: eventLevel,
    }

    this.events.push(event)

    if (this.events.length >= MAX_BATCH_SIZE) {
      this.flush()
    }

    if (!this.flushTimer) {
      this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS)
    }
  }

  private async flush(): Promise<void> {
    if (this.events.length === 0) return

    const batch = this.events.splice(0, MAX_BATCH_SIZE)
    try {
      if (!existsSync(TELEMETRY_DIR)) {
        await mkdir(TELEMETRY_DIR, { recursive: true })
      }

      const lines = batch.map(e => JSON.stringify(e)).join('\n') + '\n'
      await writeFile(EVENTS_FILE, lines, { flag: 'a' })
    } catch {
      // 写入失败时将事件放回队列
      this.events.unshift(...batch)
    }
  }

  async flushAll(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    await this.flush()
  }

  dispose(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    this.flush()
  }
}
