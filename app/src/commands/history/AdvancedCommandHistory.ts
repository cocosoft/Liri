export interface HistoryEntry {
  command: string;
  args: string;
  timestamp: number;
  success: boolean;
  duration?: number;
  tags?: string[];
  sessionId?: string;
}

export interface HistoryQuery {
  command?: string;
  fromDate?: number;
  toDate?: number;
  success?: boolean;
  tags?: string[];
  sessionId?: string;
  text?: string;
}

export interface CommandStats {
  command: string;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  avgDuration: number;
  totalDuration: number;
  lastUsed: number;
  firstUsed: number;
  favorite: boolean;
}

export interface HistoryTrend {
  period: string;
  totalCommands: number;
  uniqueCommands: number;
  successRate: number;
  avgDuration: number;
}

export interface IAdvancedCommandHistory {
  record(entry: HistoryEntry): void;
  query(q: HistoryQuery, limit?: number, offset?: number): HistoryEntry[];
  getStats(command?: string): CommandStats[];
  getTrends(periodMs: number, intervals: number): HistoryTrend[];
  getFavorites(): HistoryEntry[];
  toggleFavorite(command: string): boolean;
  getReplaySequence(from: number, to: number): HistoryEntry[];
  clear(): number;
  getTotalCount(): number;
}

export class AdvancedCommandHistory implements IAdvancedCommandHistory {
  private entries: HistoryEntry[] = [];
  private favorites: Set<string> = new Set();
  private maxEntries: number;

  constructor(maxEntries: number = 10000) {
    this.maxEntries = maxEntries;
  }

  record(entry: HistoryEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
  }

  query(
    q: HistoryQuery,
    limit: number = 50,
    offset: number = 0
  ): HistoryEntry[] {
    let filtered = [...this.entries];

    if (q.command) {
      const lower = q.command.toLowerCase();
      filtered = filtered.filter((e) =>
        e.command.toLowerCase().includes(lower)
      );
    }
    if (q.fromDate)
      filtered = filtered.filter((e) => e.timestamp >= q.fromDate!);
    if (q.toDate) filtered = filtered.filter((e) => e.timestamp <= q.toDate!);
    if (q.success !== undefined)
      filtered = filtered.filter((e) => e.success === q.success);
    if (q.tags && q.tags.length > 0) {
      filtered = filtered.filter(
        (e) => e.tags && q.tags!.some((t) => e.tags!.includes(t))
      );
    }
    if (q.sessionId)
      filtered = filtered.filter((e) => e.sessionId === q.sessionId);
    if (q.text) {
      const lower = q.text.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.command.toLowerCase().includes(lower) ||
          e.args.toLowerCase().includes(lower)
      );
    }

    return filtered.slice(offset, offset + limit);
  }

  getStats(command?: string): CommandStats[] {
    const groups = new Map<string, HistoryEntry[]>();

    for (const entry of this.entries) {
      if (command && entry.command !== command) continue;
      const list = groups.get(entry.command) || [];
      list.push(entry);
      groups.set(entry.command, list);
    }

    const stats: CommandStats[] = [];
    for (const [cmd, entries] of groups) {
      const successful = entries.filter((e) => e.success);
      const totalDuration = entries.reduce(
        (sum, e) => sum + (e.duration || 0),
        0
      );
      stats.push({
        command: cmd,
        totalExecutions: entries.length,
        successfulExecutions: successful.length,
        failedExecutions: entries.length - successful.length,
        avgDuration: entries.length > 0 ? totalDuration / entries.length : 0,
        totalDuration,
        lastUsed: Math.max(...entries.map((e) => e.timestamp)),
        firstUsed: Math.min(...entries.map((e) => e.timestamp)),
        favorite: this.favorites.has(cmd),
      });
    }

    return stats.sort((a, b) => b.totalExecutions - a.totalExecutions);
  }

  getTrends(periodMs: number, intervals: number): HistoryTrend[] {
    const now = Date.now();
    const trends: HistoryTrend[] = [];

    for (let i = intervals - 1; i >= 0; i--) {
      const start = now - (i + 1) * periodMs;
      const end = now - i * periodMs;
      const periodEntries = this.entries.filter(
        (e) => e.timestamp >= start && e.timestamp < end
      );

      const uniqueCommands = new Set(periodEntries.map((e) => e.command));
      const successful = periodEntries.filter((e) => e.success);
      const totalDuration = periodEntries.reduce(
        (sum, e) => sum + (e.duration || 0),
        0
      );

      const startDate = new Date(start);
      const period = `${startDate.getHours().toString().padStart(2, '0')}:${startDate.getMinutes().toString().padStart(2, '0')}`;

      trends.push({
        period,
        totalCommands: periodEntries.length,
        uniqueCommands: uniqueCommands.size,
        successRate:
          periodEntries.length > 0
            ? successful.length / periodEntries.length
            : 1,
        avgDuration:
          periodEntries.length > 0 ? totalDuration / periodEntries.length : 0,
      });
    }

    return trends;
  }

  getFavorites(): HistoryEntry[] {
    return this.entries.filter((e) => this.favorites.has(e.command));
  }

  toggleFavorite(command: string): boolean {
    if (this.favorites.has(command)) {
      this.favorites.delete(command);
      return false;
    } else {
      this.favorites.add(command);
      return true;
    }
  }

  getReplaySequence(from: number, to: number): HistoryEntry[] {
    return this.entries.filter((e) => e.timestamp >= from && e.timestamp <= to);
  }

  clear(): number {
    const count = this.entries.length;
    this.entries = [];
    this.favorites.clear();
    return count;
  }

  getTotalCount(): number {
    return this.entries.length;
  }
}

export const advancedCommandHistory = new AdvancedCommandHistory();
