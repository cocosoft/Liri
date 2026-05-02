import type { StructuredAnalyticsEvent } from './AnalyticsSchema'
import { AnalyticsCategory } from './AnalyticsSchema'

export interface DashboardMetrics {
  session: SessionDashboardData
  tokens: TokenDashboardData
  cost: CostDashboardData
  tools: ToolDashboardData
  errors: ErrorDashboardData
  performance: PerformanceDashboardData
  generatedAt: number
}

export interface SessionDashboardData {
  totalSessions: number
  activeSessions: number
  averageDurationMs: number
  averageTurnsPerSession: number
  totalMessages: number
}

export interface TokenDashboardData {
  totalInputTokens: number
  totalOutputTokens: number
  totalThinkingTokens: number
  averageTokensPerTurn: number
  averageTokensPerSession: number
  contextUtilizationPercent: number
}

export interface CostDashboardData {
  totalCostUSD: number
  averageCostPerSession: number
  estimatedDailyCostUSD: number
  estimatedMonthlyCostUSD: number
}

export interface ToolDashboardData {
  totalToolCalls: number
  uniqueToolsUsed: number
  topTools: Array<{ name: string; count: number }>
  blockedToolCalls: number
  persistedToolResults: number
}

export interface ErrorDashboardData {
  totalErrors: number
  errorRate: number
  topErrors: Array<{ type: string; count: number }>
  recoveryRate: number
}

export interface PerformanceDashboardData {
  averageAPILatencyMs: number
  p50LatencyMs: number
  p95LatencyMs: number
  p99LatencyMs: number
  averageToolLatencyMs: number
}

export class DashboardMetricsBuilder {
  private events: StructuredAnalyticsEvent[] = []

  addEvent(event: StructuredAnalyticsEvent): void {
    this.events.push(event)
  }

  addEvents(events: StructuredAnalyticsEvent[]): void {
    this.events.push(...events)
  }

  buildDefault(): DashboardMetrics {
    return {
      session: { totalSessions: 0, activeSessions: 0, averageDurationMs: 0, averageTurnsPerSession: 0, totalMessages: 0 },
      tokens: { totalInputTokens: 0, totalOutputTokens: 0, totalThinkingTokens: 0, averageTokensPerTurn: 0, averageTokensPerSession: 0, contextUtilizationPercent: 0 },
      cost: { totalCostUSD: 0, averageCostPerSession: 0, estimatedDailyCostUSD: 0, estimatedMonthlyCostUSD: 0 },
      tools: { totalToolCalls: 0, uniqueToolsUsed: 0, topTools: [], blockedToolCalls: 0, persistedToolResults: 0 },
      errors: { totalErrors: 0, errorRate: 0, topErrors: [], recoveryRate: 0 },
      performance: { averageAPILatencyMs: 0, p50LatencyMs: 0, p95LatencyMs: 0, p99LatencyMs: 0, averageToolLatencyMs: 0 },
      generatedAt: Date.now(),
    }
  }

  build(): DashboardMetrics {
    if (this.events.length === 0) return this.buildDefault()

    const sessionEvents = this.events.filter(e => e.category === AnalyticsCategory.SESSION)
    const tokenEvents = this.events.filter(e => e.category === AnalyticsCategory.TOKEN)
    const costEvents = this.events.filter(e => e.category === AnalyticsCategory.COST)
    const toolEvents = this.events.filter(e => e.category === AnalyticsCategory.TOOL)
    const errorEvents = this.events.filter(e => e.category === AnalyticsCategory.ERROR)
    const perfEvents = this.events.filter(e => e.category === AnalyticsCategory.PERFORMANCE)

    const toolCallCounts = new Map<string, number>()
    let blockedCalls = 0
    let persistedResults = 0

    for (const event of toolEvents) {
      const toolName = (event.metadata.toolName as string) || 'unknown'
      toolCallCounts.set(toolName, (toolCallCounts.get(toolName) || 0) + 1)
      if (event.metadata.wasBlocked) blockedCalls++
      if (event.metadata.wasPersisted) persistedResults++
    }

    const topTools = Array.from(toolCallCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    const errorTypes = new Map<string, number>()
    let recoveries = 0
    for (const event of errorEvents) {
      const errType = (event.metadata.errorType as string) || 'unknown'
      errorTypes.set(errType, (errorTypes.get(errType) || 0) + 1)
      if (event.metadata.wasRecovered) recoveries++
    }

    const latencies = perfEvents
      .map(e => e.metadata.metricValue as number)
      .filter(v => v !== undefined && v > 0)
      .sort((a, b) => a - b)

    let totalInput = 0
    let totalOutput = 0
    let totalThinking = 0
    for (const event of tokenEvents) {
      totalInput += (event.metadata.inputTokens as number) || 0
      totalOutput += (event.metadata.outputTokens as number) || 0
      totalThinking += (event.metadata.thinkingTokens as number) || 0
    }

    let totalCost = 0
    for (const event of costEvents) {
      totalCost += (event.metadata.costUSD as number) || 0
    }

    return {
      session: {
        totalSessions: sessionEvents.length,
        activeSessions: sessionEvents.filter(e => e.metadata.sessionAction !== 'ended').length,
        averageDurationMs: 0,
        averageTurnsPerSession: 0,
        totalMessages: 0,
      },
      tokens: {
        totalInputTokens: totalInput,
        totalOutputTokens: totalOutput,
        totalThinkingTokens: totalThinking,
        averageTokensPerTurn: 0,
        averageTokensPerSession: 0,
        contextUtilizationPercent: 0,
      },
      cost: {
        totalCostUSD: totalCost,
        averageCostPerSession: 0,
        estimatedDailyCostUSD: totalCost,
        estimatedMonthlyCostUSD: totalCost * 30,
      },
      tools: {
        totalToolCalls: toolEvents.length,
        uniqueToolsUsed: toolCallCounts.size,
        topTools,
        blockedToolCalls: blockedCalls,
        persistedToolResults: persistedResults,
      },
      errors: {
        totalErrors: errorEvents.length,
        errorRate: this.events.length > 0 ? errorEvents.length / this.events.length : 0,
        topErrors: Array.from(errorTypes.entries())
          .map(([type, count]) => ({ type, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10),
        recoveryRate: errorEvents.length > 0 ? recoveries / errorEvents.length : 0,
      },
      performance: {
        averageAPILatencyMs: latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
        p50LatencyMs: this.percentile(latencies, 50),
        p95LatencyMs: this.percentile(latencies, 95),
        p99LatencyMs: this.percentile(latencies, 99),
        averageToolLatencyMs: 0,
      },
      generatedAt: Date.now(),
    }
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0
    const idx = Math.ceil((p / 100) * sorted.length) - 1
    return sorted[Math.max(0, Math.min(idx, sorted.length - 1))]
  }
}
