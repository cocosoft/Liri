/**
 * Agent Tool Memory
 * 对标CC agentMemory.ts
 * Agent工具级别的执行记录与记忆管理
 */

export interface AgentRecord {
  id: string;
  agentName: string;
  agentType?: string;
  taskDescription: string;
  startedAt: number;
  completedAt?: number;
  duration?: number;
  success: boolean;
  error?: string;
  summary?: string;
  resultPreview?: string;
  tokenUsage?: { input: number; output: number };
  metadata?: Record<string, unknown>;
}

export interface AgentMemoryConfig {
  maxRecords?: number;
  ttlMs?: number;
  enabled?: boolean;
}

const DEFAULT_CONFIG: Required<AgentMemoryConfig> = {
  maxRecords: 100,
  ttlMs: 30 * 60 * 1000,
  enabled: true,
};

export class AgentToolMemory {
  private records: AgentRecord[] = [];
  private config: Required<AgentMemoryConfig>;

  constructor(config?: AgentMemoryConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  add(record: AgentRecord): void {
    if (!this.config.enabled) return;

    this.evictExpired();
    this.records.push(record);

    if (this.records.length > this.config.maxRecords) {
      this.records.sort((a, b) => b.startedAt - a.startedAt);
      this.records = this.records.slice(0, this.config.maxRecords);
    }
  }

  update(
    id: string,
    updates: Partial<AgentRecord>,
  ): AgentRecord | null {
    const record = this.records.find((r) => r.id === id);
    if (!record) return null;

    Object.assign(record, updates);
    return record;
  }

  get(id: string): AgentRecord | null {
    return this.records.find((r) => r.id === id) ?? null;
  }

  query(options?: {
    agentName?: string;
    success?: boolean;
    since?: number;
    limit?: number;
  }): AgentRecord[] {
    let result = [...this.records];

    if (options?.agentName) {
      result = result.filter((r) => r.agentName === options.agentName);
    }

    if (options?.success !== undefined) {
      result = result.filter((r) => r.success === options.success);
    }

    if (options?.since) {
      result = result.filter((r) => r.startedAt >= options.since!);
    }

    result.sort((a, b) => b.startedAt - a.startedAt);

    if (options?.limit && result.length > options.limit) {
      result = result.slice(0, options.limit);
    }

    return result;
  }

  getRecent(limit: number = 10): AgentRecord[] {
    return this.query({ limit });
  }

  getStats(): {
    total: number;
    successful: number;
    failed: number;
    avgDuration: number;
    totalTokens: { input: number; output: number };
  } {
    const successful = this.records.filter((r) => r.success);
    const failed = this.records.filter((r) => !r.success);
    const durations = this.records
      .filter((r) => r.duration !== undefined)
      .map((r) => r.duration!);

    const avgDuration = durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;

    const totalTokens = this.records.reduce(
      (acc, r) => {
        if (r.tokenUsage) {
          acc.input += r.tokenUsage.input;
          acc.output += r.tokenUsage.output;
        }
        return acc;
      },
      { input: 0, output: 0 },
    );

    return {
      total: this.records.length,
      successful: successful.length,
      failed: failed.length,
      avgDuration,
      totalTokens,
    };
  }

  clear(): void {
    this.records = [];
  }

  removeExpired(): number {
    const before = this.records.length;
    this.evictExpired();
    return before - this.records.length;
  }

  private evictExpired(): void {
    if (this.config.ttlMs <= 0) return;

    const cutoff = Date.now() - this.config.ttlMs;
    this.records = this.records.filter(
      (r) => r.startedAt >= cutoff || !r.completedAt,
    );
  }

  toSnapshot(): AgentMemorySnapshot {
    return {
      records: [...this.records],
      config: { ...this.config },
      stats: this.getStats(),
      timestamp: Date.now(),
    };
  }

  fromSnapshot(snapshot: AgentMemorySnapshot): void {
    this.records = [...snapshot.records];
    this.config = { ...snapshot.config };
  }
}

export interface AgentMemorySnapshot {
  records: AgentRecord[];
  config: Required<AgentMemoryConfig>;
  stats: ReturnType<AgentToolMemory['getStats']>;
  timestamp: number;
}
