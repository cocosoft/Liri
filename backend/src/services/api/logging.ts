/**
 * API 日志客户端
 *
 * 记录 API 请求/响应日志，支持处理器链和实时事件分发。
 * 与 ApiLoggingService 互补 — 后者保存记录做统计，此模块负责实时分发。
 */
import type { ApiLogEntry } from './ApiLogging'

/**
 * API 请求日志级别
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * 日志处理器回调
 */
export type LogHandler = (entry: ApiLogEntry) => void

const handlers: Set<LogHandler> = new Set()
let enabled = true

/**
 * 注册日志处理器
 */
export function addLogHandler(handler: LogHandler): void {
  handlers.add(handler)
}

/**
 * 移除日志处理器
 */
export function removeLogHandler(handler: LogHandler): void {
  handlers.delete(handler)
}

/**
 * 设置日志启用状态
 */
export function setLoggingEnabled(state: boolean): void {
  enabled = state
}

/**
 * 创建 ApiLogEntry
 */
function createEntry(overrides: Partial<ApiLogEntry> & {
  requestId: string
  method: string
  path: string
}): ApiLogEntry {
  return {
    requestId: overrides.requestId,
    method: overrides.method,
    path: overrides.path,
    statusCode: overrides.statusCode ?? 0,
    latencyMs: overrides.latencyMs ?? 0,
    provider: overrides.provider ?? 'unknown',
    model: overrides.model ?? 'unknown',
    error: overrides.error,
    retryCount: overrides.retryCount,
    tokenUsage: overrides.tokenUsage,
    timestamp: overrides.timestamp ?? new Date(),
  }
}

/**
 * 通知所有日志处理器
 */
function notifyHandlers(entry: ApiLogEntry): void {
  if (!enabled) return

  for (const handler of handlers) {
    try {
      handler(entry)
    } catch {
      // 避免日志处理器抛出异常导致主流程中断
    }
  }
}

/**
 * 记录 API 请求开始
 */
export function logRequestStart(
  requestId: string,
  method: string,
  path: string,
  provider?: string,
  model?: string
): void {
  const entry = createEntry({
    requestId,
    method,
    path,
    provider,
    model,
  })

  notifyHandlers(entry)
}

/**
 * 记录 API 请求成功
 */
export function logRequestSuccess(params: {
  requestId: string
  method: string
  path: string
  statusCode: number
  latencyMs: number
  provider?: string
  model?: string
  tokenUsage?: ApiLogEntry['tokenUsage']
}): void {
  const entry = createEntry({
    requestId: params.requestId,
    method: params.method,
    path: params.path,
    statusCode: params.statusCode,
    latencyMs: params.latencyMs,
    provider: params.provider,
    model: params.model,
    tokenUsage: params.tokenUsage,
  })

  notifyHandlers(entry)
}

/**
 * 记录 API 请求错误
 */
export function logRequestError(params: {
  requestId: string
  method: string
  path: string
  statusCode?: number
  latencyMs: number
  error: string
  provider?: string
  model?: string
}): void {
  const entry = createEntry({
    requestId: params.requestId,
    method: params.method,
    path: params.path,
    statusCode: params.statusCode,
    latencyMs: params.latencyMs,
    provider: params.provider,
    model: params.model,
    error: params.error,
  })

  notifyHandlers(entry)
}

/**
 * 控制台日志处理器（默认注册）
 */
export function consoleLogHandler(entry: ApiLogEntry): void {
  const prefix = entry.error ? '[API ERROR]' : '[API INFO]'
  const status = entry.statusCode ? ` ${entry.statusCode}` : ''
  const duration = entry.latencyMs ? ` (${entry.latencyMs}ms)` : ''
  const error = entry.error ? ` — ${entry.error}` : ''

  if (entry.error) {
    console.error(`${prefix} ${entry.method} ${entry.path}${status}${duration}${error}`)
  } else {
    console.log(`${prefix} ${entry.method} ${entry.path}${status}${duration}${error}`)
  }
}

// 默认注册控制台日志处理器
addLogHandler(consoleLogHandler)
