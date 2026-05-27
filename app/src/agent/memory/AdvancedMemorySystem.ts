import { AgentMemory, AgentMemoryScope } from '../models/types';
import { AgentMemoryImpl, MemoryItem } from './agentMemory';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

interface MemoryVector {
  id: string;
  vector: number[];
  content: any;
  timestamp: number;
  tags: string[];
}

interface SearchOptions {
  limit?: number;
  threshold?: number;
  tags?: string[];
  scope?: AgentMemoryScope;
  timeRange?: { start: number; end: number };
}

interface MemoryExport {
  version: string;
  exportedAt: number;
  agentId: string;
  items: MemoryEntry[];
  metadata: {
    totalItems: number;
    oldestItem: number;
    newestItem: number;
    averageImportance: number;
  };
}

interface MemoryEntry {
  id: string;
  key: string;
  content: any;
  vector?: number[];
  tags: string[];
  timestamp: number;
  importance: number;
  version: number;
  scope: AgentMemoryScope;
}

interface MemoryStats {
  totalItems: number;
  shortTermCount: number;
  longTermCount: number;
  archivedCount: number;
  averageImportance: number;
  memoryUsage: number;
  oldestItem: number | null;
  newestItem: number | null;
}

interface MemoryCompressionResult {
  originalSize: number;
  compressedSize: number;
  itemsRemoved: number;
  itemsArchived: number;
  duration: number;
}

interface MemoryVersion {
  version: number;
  timestamp: number;
  changes: string[];
  snapshot: Record<string, MemoryEntry>;
}

export class AdvancedMemorySystem {
  private shortTermMemory: AgentMemoryImpl;
  private longTermMemory: AgentMemoryImpl;
  private archivedMemory: AgentMemoryImpl;
  private vectorIndex: Map<string, MemoryVector> = new Map();
  private versionHistory: MemoryVersion[] = [];
  private currentVersion: number = 0;
  private maxShortTermItems: number = 100;
  private maxLongTermItems: number = 10000;
  private importanceThreshold: number = 0.5;
  private consolidationInterval: number = 3600000;
  private consolidationTimer: ReturnType<typeof setInterval> | null = null;

  constructor(memoryPath: string) {
    this.shortTermMemory = new AgentMemoryImpl(
      `${memoryPath}/short_term.json`,
      'local'
    );
    this.longTermMemory = new AgentMemoryImpl(
      `${memoryPath}/long_term.json`,
      'user'
    );
    this.archivedMemory = new AgentMemoryImpl(
      `${memoryPath}/archived.json`,
      'local'
    );
    this.startConsolidation();
  }

  add(key: string, value: any, tags?: string[]): void {
    const importance = this.calculateImportance(value);
    const vector = this.vectorize(value);

    if (importance >= this.importanceThreshold) {
      this.longTermMemory.add(key, value, tags);
    } else {
      this.shortTermMemory.add(key, value, tags);
    }

    if (vector) {
      this.vectorIndex.set(key, {
        id: key,
        vector,
        content: value,
        timestamp: Date.now(),
        tags: tags || [],
      });
    }

    this.createVersion(`add:${key}`);
  }

  get(key: string): any {
    let value = this.shortTermMemory.get(key);
    if (value !== undefined) return value;

    value = this.longTermMemory.get(key);
    if (value !== undefined) return value;

    value = this.archivedMemory.get(key);
    return value;
  }

  delete(key: string): void {
    this.shortTermMemory.delete(key);
    this.longTermMemory.delete(key);
    this.archivedMemory.delete(key);
    this.vectorIndex.delete(key);
    this.createVersion(`delete:${key}`);
  }

  clear(): void {
    this.shortTermMemory.clear();
    this.longTermMemory.clear();
    this.archivedMemory.clear();
    this.vectorIndex.clear();
    this.createVersion('clear');
  }

  getAll(): Record<string, unknown> {
    return {
      ...this.shortTermMemory.getAll(),
      ...this.longTermMemory.getAll(),
      ...this.archivedMemory.getAll(),
    };
  }

  search(query: string, options: SearchOptions = {}): MemoryEntry[] {
    const queryVector = this.vectorize(query);
    if (!queryVector) return [];

    const limit = options.limit || 10;
    const threshold = options.threshold || 0.5;

    const scored: Array<{ entry: MemoryEntry; score: number }> = [];

    for (const [, vector] of this.vectorIndex) {
      const score = this.cosineSimilarity(queryVector, vector.vector);

      if (score >= threshold) {
        const entry = this.buildEntry(vector);
        if (entry && this.matchesOptions(entry, options)) {
          scored.push({ entry, score });
        }
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.entry);
  }

  similaritySearch(vector: number[], limit: number = 10): MemoryEntry[] {
    const scored: Array<{ entry: MemoryEntry; score: number }> = [];

    for (const [, memVector] of this.vectorIndex) {
      const score = this.cosineSimilarity(vector, memVector.vector);
      scored.push({
        entry: this.buildEntry(memVector)!,
        score,
      });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.entry);
  }

  async compressMemory(): Promise<MemoryCompressionResult> {
    const startTime = Date.now();
    const originalSize =
      Object.keys(this.shortTermMemory.getAll()).length +
      Object.keys(this.longTermMemory.getAll()).length;

    let itemsRemoved = 0;
    let itemsArchived = 0;

    const shortTermEntries = Object.entries(this.shortTermMemory.getAll());
    for (const [key, value] of shortTermEntries) {
      const val = value as Record<string, unknown>;
      const age = Date.now() - (this.getTimestamp(val) || Date.now());
      const importance = this.calculateImportance(val);

      if (age > 86400000 && importance < 0.3) {
        this.shortTermMemory.delete(key);
        itemsRemoved++;
      } else if (age > 604800000) {
        this.shortTermMemory.delete(key);
        this.archivedMemory.add(key, val);
        itemsArchived++;
      }
    }

    const longTermEntries = Object.entries(this.longTermMemory.getAll());
    for (const [key, value] of longTermEntries) {
      const val = value as Record<string, unknown>;
      const age = Date.now() - (this.getTimestamp(val) || Date.now());
      const importance = this.calculateImportance(val);

      if (age > 2592000000 && importance < 0.2) {
        this.longTermMemory.delete(key);
        this.archivedMemory.add(key, val);
        itemsArchived++;
      }
    }

    const compressedSize =
      Object.keys(this.shortTermMemory.getAll()).length +
      Object.keys(this.longTermMemory.getAll()).length;
    const duration = Date.now() - startTime;

    this.createVersion('compress');

    return {
      originalSize,
      compressedSize,
      itemsRemoved,
      itemsArchived,
      duration,
    };
  }

  exportMemory(): MemoryExport {
    const allItems = this.getAll();
    const entries: MemoryEntry[] = [];
    let oldestItem = Date.now();
    let newestItem = 0;
    let totalImportance = 0;

    for (const [key, value] of Object.entries(allItems)) {
      const val = value as Record<string, unknown>;
      const vector = this.vectorIndex.get(key);
      const timestamp = this.getTimestamp(val) || Date.now();
      const importance = this.calculateImportance(val);

      oldestItem = Math.min(oldestItem, timestamp);
      newestItem = Math.max(newestItem, timestamp);
      totalImportance += importance;

      entries.push({
        id: `mem_${key}_${timestamp}`,
        key,
        content: value,
        vector: vector?.vector,
        tags: vector?.tags || [],
        timestamp,
        importance,
        version: this.currentVersion,
        scope: 'local',
      });
    }

    return {
      version: `${this.currentVersion}.0.0`,
      exportedAt: Date.now(),
      agentId: 'advanced_memory_system',
      items: entries,
      metadata: {
        totalItems: entries.length,
        oldestItem,
        newestItem,
        averageImportance:
          entries.length > 0 ? totalImportance / entries.length : 0,
      },
    };
  }

  getStats(): MemoryStats {
    const shortTermCount = Object.keys(this.shortTermMemory.getAll()).length;
    const longTermCount = Object.keys(this.longTermMemory.getAll()).length;
    const archivedCount = Object.keys(this.archivedMemory.getAll()).length;
    const allItems = this.getAll();
    const entries = Object.values(allItems);

    let totalImportance = 0;
    let oldestItem: number | null = null;
    let newestItem: number | null = null;

    for (const value of entries) {
      const ts = this.getTimestamp(value) || Date.now();
      totalImportance += this.calculateImportance(value);
      if (oldestItem === null || ts < oldestItem) oldestItem = ts;
      if (newestItem === null || ts > newestItem) newestItem = ts;
    }

    return {
      totalItems: shortTermCount + longTermCount + archivedCount,
      shortTermCount,
      longTermCount,
      archivedCount,
      averageImportance:
        entries.length > 0 ? totalImportance / entries.length : 0,
      memoryUsage: this.vectorIndex.size * 384,
      oldestItem,
      newestItem,
    };
  }

  getVersionHistory(): MemoryVersion[] {
    return [...this.versionHistory];
  }

  async rollback(version: number): Promise<boolean> {
    const target = this.versionHistory.find((v) => v.version === version);
    if (!target) {
      logger.warn(`Version ${version} not found for rollback`);
      return false;
    }

    this.shortTermMemory.clear();
    this.longTermMemory.clear();
    this.archivedMemory.clear();
    this.vectorIndex.clear();

    for (const [, entry] of Object.entries(target.snapshot)) {
      const targetScope = entry.scope;
      if (targetScope === 'local' || targetScope === 'user') {
        if (entry.importance >= this.importanceThreshold) {
          this.longTermMemory.add(entry.key, entry.content, entry.tags);
        } else {
          this.shortTermMemory.add(entry.key, entry.content, entry.tags);
        }
      } else {
        this.archivedMemory.add(entry.key, entry.content, entry.tags);
      }

      if (entry.vector) {
        this.vectorIndex.set(entry.key, {
          id: entry.key,
          vector: entry.vector,
          content: entry.content,
          timestamp: entry.timestamp,
          tags: entry.tags,
        });
      }
    }

    this.currentVersion = version;
    this.createVersion(`rollback:${version}`);
    logger.info(`Rolled back to version ${version}`);
    return true;
  }

  shutdown(): void {
    if (this.consolidationTimer) {
      clearInterval(this.consolidationTimer);
      this.consolidationTimer = null;
    }
    this.shortTermMemory.save();
    this.longTermMemory.save();
    this.archivedMemory.save();
  }

  private calculateImportance(value: any): number {
    if (typeof value === 'string') {
      return Math.min(1, value.length / 1000);
    }
    if (typeof value === 'object' && value !== null) {
      const keys = Object.keys(value);
      const hasTimestamp = 'timestamp' in value || 'time' in value;
      const hasTags = 'tags' in value || 'category' in value;
      return Math.min(
        1,
        (keys.length + (hasTimestamp ? 0.2 : 0) + (hasTags ? 0.2 : 0)) / 10
      );
    }
    return 0.5;
  }

  private vectorize(content: any): number[] | null {
    try {
      const str =
        typeof content === 'string' ? content : JSON.stringify(content);
      const hash = this.simpleHash(str);
      const vector: number[] = [];
      let seed = hash;

      for (let i = 0; i < 64; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        vector.push((seed % 1000) / 1000);
      }

      return vector;
    } catch {
      return null;
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude > 0 ? dotProduct / magnitude : 0;
  }

  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  private getTimestamp(value: any): number | null {
    if (typeof value === 'object' && value !== null) {
      if (value.timestamp) return value.timestamp;
      if (value.time)
        return typeof value.time === 'number'
          ? value.time
          : Date.parse(value.time);
    }
    return null;
  }

  private buildEntry(vector: MemoryVector): MemoryEntry | null {
    const value = this.get(vector.id);
    if (value === undefined) return null;

    return {
      id: `mem_${vector.id}_${vector.timestamp}`,
      key: vector.id,
      content: value,
      vector: vector.vector,
      tags: vector.tags,
      timestamp: vector.timestamp,
      importance: this.calculateImportance(value),
      version: this.currentVersion,
      scope: 'local',
    };
  }

  private matchesOptions(entry: MemoryEntry, options: SearchOptions): boolean {
    if (options.tags && options.tags.length > 0) {
      const hasTag = options.tags.some((t) => entry.tags.includes(t));
      if (!hasTag) return false;
    }

    if (options.timeRange) {
      if (
        entry.timestamp < options.timeRange.start ||
        entry.timestamp > options.timeRange.end
      ) {
        return false;
      }
    }

    return true;
  }

  private createVersion(change: string): void {
    this.currentVersion++;

    const snapshot: Record<string, MemoryEntry> = {};
    const allItems = this.getAll();
    for (const [key, value] of Object.entries(allItems)) {
      const vector = this.vectorIndex.get(key);
      snapshot[key] = {
        id: `mem_${key}_${Date.now()}`,
        key,
        content: value,
        vector: vector?.vector,
        tags: vector?.tags || [],
        timestamp: Date.now(),
        importance: this.calculateImportance(value),
        version: this.currentVersion,
        scope: 'local',
      };
    }

    this.versionHistory.push({
      version: this.currentVersion,
      timestamp: Date.now(),
      changes: [change],
      snapshot,
    });

    if (this.versionHistory.length > 50) {
      this.versionHistory = this.versionHistory.slice(-50);
    }
  }

  private startConsolidation(): void {
    this.consolidationTimer = setInterval(async () => {
      try {
        const result = await this.compressMemory();
        if (result.itemsRemoved > 0 || result.itemsArchived > 0) {
          logger.info(
            `Memory consolidation: removed ${result.itemsRemoved}, archived ${result.itemsArchived}`
          );
        }
      } catch (error) {
        logger.error('Memory consolidation failed:', error as Error);
      }
    }, this.consolidationInterval);
  }
}
