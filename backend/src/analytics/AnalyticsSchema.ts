import type { AnalyticsEvent } from './types'

export interface StructuredAnalyticsEvent extends AnalyticsEvent {
  schemaVersion: string
  category: AnalyticsCategory
  severity: AnalyticsSeverity
  sessionId?: string
  turnId?: number
  correlationId?: string
}

export enum AnalyticsCategory {
  QUERY = 'query',
  TOOL = 'tool',
  API = 'api',
  SESSION = 'session',
  COST = 'cost',
  TOKEN = 'token',
  ERROR = 'error',
  SECURITY = 'security',
  PERFORMANCE = 'performance',
  UI = 'ui',
  SYSTEM = 'system',
}

export enum AnalyticsSeverity {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  CRITICAL = 'critical',
}

export interface QueryEvent extends StructuredAnalyticsEvent {
  category: AnalyticsCategory.QUERY
  promptLength: number
  responseLength: number
  modelName: string
  thinkingEnabled: boolean
  thinkingEffort?: string
  toolsUsed: string[]
  durationMs: number
}

export interface ToolEvent extends StructuredAnalyticsEvent {
  category: AnalyticsCategory.TOOL
  toolName: string
  toolAction: 'call' | 'result' | 'error' | 'permission' | 'timeout'
  durationMs: number
  resultSize?: number
  wasPersisted?: boolean
  wasBlocked?: boolean
}

export interface TokenEvent extends StructuredAnalyticsEvent {
  category: AnalyticsCategory.TOKEN
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  thinkingTokens: number
  contextSize: number
  percentUsed: number
}

export interface CostEvent extends StructuredAnalyticsEvent {
  category: AnalyticsCategory.COST
  costUSD: number
  costType: 'api' | 'storage' | 'compute'
  modelName: string
  cumulativeCostUSD: number
}

export interface SessionEvent extends StructuredAnalyticsEvent {
  category: AnalyticsCategory.SESSION
  sessionAction: 'created' | 'resumed' | 'compacted' | 'ended'
  messageCount: number
  turnCount: number
}

export interface ErrorEvent extends StructuredAnalyticsEvent {
  category: AnalyticsCategory.ERROR
  errorType: string
  errorMessage: string
  stackTrace?: string
  retryable: boolean
  wasRecovered: boolean
}

export interface PerformanceEvent extends StructuredAnalyticsEvent {
  category: AnalyticsCategory.PERFORMANCE
  metricName: string
  metricValue: number
  metricUnit: 'ms' | 'bytes' | 'count' | 'percent'
  threshold?: number
}

export type TypedAnalyticsEvent =
  | QueryEvent
  | ToolEvent
  | TokenEvent
  | CostEvent
  | SessionEvent
  | ErrorEvent
  | PerformanceEvent

export function createTypedEvent<T extends StructuredAnalyticsEvent>(
  base: Partial<T> & { category: AnalyticsCategory; eventName: string; severity?: AnalyticsSeverity },
): T {
  return {
    timestamp: Date.now(),
    async: false,
    schemaVersion: '1.0.0',
    severity: base.severity ?? AnalyticsSeverity.INFO,
    ...base,
    metadata: base.metadata ?? {},
  } as unknown as T
}

export function getCategoryForEvent(eventName: string): AnalyticsCategory {
  const lower = eventName.toLowerCase()
  if (lower.includes('query') || lower.includes('prompt')) return AnalyticsCategory.QUERY
  if (lower.includes('tool')) return AnalyticsCategory.TOOL
  if (lower.includes('token') || lower.includes('usage')) return AnalyticsCategory.TOKEN
  if (lower.includes('cost') || lower.includes('budget')) return AnalyticsCategory.COST
  if (lower.includes('session') || lower.includes('compact')) return AnalyticsCategory.SESSION
  if (lower.includes('error') || lower.includes('fail')) return AnalyticsCategory.ERROR
  if (lower.includes('perf') || lower.includes('metric')) return AnalyticsCategory.PERFORMANCE
  if (lower.includes('security') || lower.includes('auth')) return AnalyticsCategory.SECURITY
  return AnalyticsCategory.SYSTEM
}
