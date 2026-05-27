import { EventEmitter } from 'events';
import { NodeDefinition, NodeSession, NodeMetrics } from './types.js';
import { NodeInvoke } from './NodeInvoke.js';

export class NodeRunner extends EventEmitter {
  private sessions: Map<string, NodeSession> = new Map();
  private nodeInvoke: NodeInvoke;
  private metrics: Map<
    string,
    {
      total: number;
      success: number;
      failed: number;
      totalDuration: number;
      lastInvoked: number;
    }
  > = new Map();
  private running: boolean = false;

  constructor(nodeInvoke: NodeInvoke) {
    super();
    this.nodeInvoke = nodeInvoke;
  }

  start(): void {
    this.running = true;
    this.emit('runner:started');
  }

  stop(): void {
    this.running = false;
    this.emit('runner:stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  async runNode(
    definition: NodeDefinition,
    operation: string,
    args: Record<string, unknown> = {}
  ): Promise<NodeSession> {
    const session: NodeSession = {
      id: this.generateSessionId(),
      nodeId: definition.id,
      status: 'running',
      startedAt: Date.now(),
      operations: 0,
      errors: 0,
    };

    this.sessions.set(session.id, session);
    this.nodeInvoke.registerNode(definition);

    this.emit('session:started', session);

    const response = await this.nodeInvoke.invoke({
      nodeId: definition.id,
      operation,
      args,
    });

    session.operations++;

    if (response.success) {
      session.status = 'completed';
    } else {
      session.status = 'failed';
      session.errors++;
    }

    session.completedAt = Date.now();
    this.updateMetrics(definition.id, response.success, response.durationMs);

    this.emit('session:completed', session);

    return session;
  }

  getSession(sessionId: string): NodeSession | undefined {
    return this.sessions.get(sessionId);
  }

  getSessions(nodeId?: string): NodeSession[] {
    const all = Array.from(this.sessions.values());

    if (nodeId) {
      return all.filter((s) => s.nodeId === nodeId);
    }

    return all;
  }

  getMetrics(nodeId: string): NodeMetrics {
    const m = this.metrics.get(nodeId);

    if (!m) {
      return {
        nodeId,
        totalInvocations: 0,
        successfulInvocations: 0,
        failedInvocations: 0,
        avgDurationMs: 0,
        isCircuitBroken: false,
        errorRate: 0,
      };
    }

    return {
      nodeId,
      totalInvocations: m.total,
      successfulInvocations: m.success,
      failedInvocations: m.failed,
      avgDurationMs: m.total > 0 ? Math.round(m.totalDuration / m.total) : 0,
      lastInvokedAt: m.lastInvoked,
      isCircuitBroken: false,
      errorRate: m.total > 0 ? m.failed / m.total : 0,
    };
  }

  getAllMetrics(): NodeMetrics[] {
    return Array.from(this.metrics.keys()).map((nodeId) =>
      this.getMetrics(nodeId)
    );
  }

  clearSessions(): void {
    this.sessions.clear();
    this.emit('sessions:cleared');
  }

  private updateMetrics(
    nodeId: string,
    success: boolean,
    durationMs: number
  ): void {
    let m = this.metrics.get(nodeId);

    if (!m) {
      m = { total: 0, success: 0, failed: 0, totalDuration: 0, lastInvoked: 0 };
      this.metrics.set(nodeId, m);
    }

    m.total++;
    m.totalDuration += durationMs;
    m.lastInvoked = Date.now();

    if (success) {
      m.success++;
    } else {
      m.failed++;
    }
  }

  private generateSessionId(): string {
    return `ns-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}
