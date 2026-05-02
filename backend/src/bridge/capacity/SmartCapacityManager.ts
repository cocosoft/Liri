export interface ResourceMetrics {
  cpuUsage: number;
  memoryUsage: number;
  sessionSlots: number;
  totalSlots: number;
}

export interface CapacityStatus {
  currentLoad: number;
  maxCapacity: number;
  availableResources: ResourceMetrics;
  recommendations: string[];
  timestamp: number;
}

export interface CapacityThresholds {
  cpuPercent: number;
  memoryPercent: number;
  slotPercent: number;
}

export interface LoadBalanceAction {
  targetSessionId: string;
  action: 'redirect' | 'throttle' | 'scale_down';
  reason: string;
  weight: number;
}

export interface ICapacityManager {
  analyze(): Promise<CapacityStatus>;
  balanceLoad(): Promise<LoadBalanceAction[]>;
  getMetrics(): ResourceMetrics;
  setThresholds(thresholds: Partial<CapacityThresholds>): void;
}

export class SmartCapacityManager implements ICapacityManager {
  private thresholds: CapacityThresholds = {
    cpuPercent: 80,
    memoryPercent: 85,
    slotPercent: 90,
  };
  private sessions: Map<string, { load: number; lastActive: number }> = new Map();

  registerSession(sessionId: string): void {
    this.sessions.set(sessionId, { load: 0, lastActive: Date.now() });
  }

  unregisterSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  updateSessionLoad(sessionId: string, load: number): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.load = Math.max(0, Math.min(1, load));
      session.lastActive = Date.now();
    }
  }

  async analyze(): Promise<CapacityStatus> {
    const totalSlots = 100;
    const usedSlots = this.sessions.size;
    const avgLoad = usedSlots > 0
      ? Array.from(this.sessions.values()).reduce((sum, s) => sum + s.load, 0) / usedSlots
      : 0;

    const cpuUsage = avgLoad * 100;
    const memoryUsage = (usedSlots / totalSlots) * 100;

    const recommendations: string[] = [];
    if (cpuUsage > this.thresholds.cpuPercent) {
      recommendations.push('CPU 负载过高，建议增加节点或减少并发会话');
    }
    if (memoryUsage > this.thresholds.memoryPercent) {
      recommendations.push('内存使用率过高，建议清理空闲会话');
    }
    if (usedSlots / totalSlots > this.thresholds.slotPercent / 100) {
      recommendations.push('会话槽位即将用尽，建议扩容');
    }
    if (recommendations.length === 0) {
      recommendations.push('系统运行正常，无需调整');
    }

    return {
      currentLoad: avgLoad * 100,
      maxCapacity: 100,
      availableResources: {
        cpuUsage: Math.round(cpuUsage),
        memoryUsage: Math.round(memoryUsage),
        sessionSlots: usedSlots,
        totalSlots,
      },
      recommendations,
      timestamp: Date.now(),
    };
  }

  async balanceLoad(): Promise<LoadBalanceAction[]> {
    const actions: LoadBalanceAction[] = [];
    const sorted = Array.from(this.sessions.entries()).sort((a, b) => b[1].load - a[1].load);

    if (sorted.length >= 2) {
      const highest = sorted[0];
      const lowest = sorted[sorted.length - 1];
      if (highest[1].load > 0.8 && lowest[1].load < 0.3) {
        actions.push({
          targetSessionId: highest[0],
          action: 'redirect',
          reason: `负载 ${Math.round(highest[1].load * 100)}%，高于阈值 80%`,
          weight: Math.min(highest[1].load - lowest[1].load, 0.5),
        });
      }
    }

    const highLoad = sorted.filter(([, v]) => v.load > 0.9);
    for (const [id] of highLoad) {
      actions.push({
        targetSessionId: id,
        action: 'throttle',
        reason: `负载 ${Math.round(this.sessions.get(id)!.load * 100)}%，高于 90%`,
        weight: 0.3,
      });
    }

    return actions;
  }

  getMetrics(): ResourceMetrics {
    const usedSlots = this.sessions.size;
    const avgLoad = usedSlots > 0
      ? Array.from(this.sessions.values()).reduce((sum, s) => sum + s.load, 0) / usedSlots
      : 0;
    return {
      cpuUsage: Math.round(avgLoad * 100),
      memoryUsage: Math.round((usedSlots / 100) * 100),
      sessionSlots: usedSlots,
      totalSlots: 100,
    };
  }

  setThresholds(thresholds: Partial<CapacityThresholds>): void {
    Object.assign(this.thresholds, thresholds);
  }
}
