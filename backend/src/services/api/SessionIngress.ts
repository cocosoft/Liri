/**
 * 会话入口跟踪服务
 *
 * 跟踪会话的启动入口（CLI、Bridge、MCP 等），
 * 记录会话创建和恢复相关的分析事件。
 */

export interface SessionIngressEvent {
  sessionId: string
  ingressType: 'cli' | 'bridge' | 'mcp' | 'repl' | 'api'
  timestamp: Date
  cwd?: string
  remoteSessionId?: string
  isResume?: boolean
  extra?: Record<string, unknown>
}

export interface SessionIngressStats {
  totalSessions: number
  byType: Record<string, number>
  resumes: number
  newSessions: number
}

export class SessionIngressService {
  private events: SessionIngressEvent[] = []
  private stats: SessionIngressStats = {
    totalSessions: 0,
    byType: {},
    resumes: 0,
    newSessions: 0,
  }

  recordSessionIngress(event: SessionIngressEvent): void {
    this.events.push(event)

    this.stats.totalSessions++
    this.stats.byType[event.ingressType] =
      (this.stats.byType[event.ingressType] || 0) + 1

    if (event.isResume) {
      this.stats.resumes++
    } else {
      this.stats.newSessions++
    }
  }

  getSessionIngressStats(): SessionIngressStats {
    return { ...this.stats }
  }

  getRecentSessions(limit: number = 50): SessionIngressEvent[] {
    return this.events.slice(-limit).reverse()
  }

  getSessionsByType(type: string): SessionIngressEvent[] {
    return this.events.filter((e) => e.ingressType === type)
  }

  clear(): void {
    this.events = []
    this.stats = {
      totalSessions: 0,
      byType: {},
      resumes: 0,
      newSessions: 0,
    }
  }
}
