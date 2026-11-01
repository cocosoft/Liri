export interface IndexEntry {
  memoryId: string;
  tags: string[];
  type: string;
  createdAt: number;
  updatedAt: number;
  contentHash: string;
  contentPreview: string;
}

export interface IndexQuery {
  tags?: string[];
  type?: string;
  startTime?: number;
  endTime?: number;
  keyword?: string;
  limit?: number;
  offset?: number;
}

export interface IndexStats {
  totalEntries: number;
  byType: Record<string, number>;
  byTag: Record<string, number>;
  lastIndexedAt: number;
}

export interface IMemoryIndexer {
  index(entry: IndexEntry): void;
  batchIndex(entries: IndexEntry[]): void;
  remove(memoryId: string): boolean;
  search(query: IndexQuery): IndexEntry[];
  getByTag(tag: string): IndexEntry[];
  getByType(type: string): IndexEntry[];
  getByTimeRange(start: number, end: number): IndexEntry[];
  searchByKeyword(keyword: string, limit?: number): IndexEntry[];
  getStats(): IndexStats;
  clear(): void;
}

export class MemoryIndexer implements IMemoryIndexer {
  private entries: Map<string, IndexEntry> = new Map();
  private tagIndex: Map<string, Set<string>> = new Map();
  private typeIndex: Map<string, Set<string>> = new Map();

  index(entry: IndexEntry): void {
    this.entries.set(entry.memoryId, entry);
    for (const tag of entry.tags) {
      if (!this.tagIndex.has(tag)) this.tagIndex.set(tag, new Set());
      this.tagIndex.get(tag)!.add(entry.memoryId);
    }
    if (!this.typeIndex.has(entry.type))
      this.typeIndex.set(entry.type, new Set());
    this.typeIndex.get(entry.type)!.add(entry.memoryId);
  }

  batchIndex(entries: IndexEntry[]): void {
    for (const entry of entries) this.index(entry);
  }

  remove(memoryId: string): boolean {
    const entry = this.entries.get(memoryId);
    if (!entry) return false;
    for (const tag of entry.tags) {
      this.tagIndex.get(tag)?.delete(memoryId);
      if (this.tagIndex.get(tag)?.size === 0) this.tagIndex.delete(tag);
    }
    this.typeIndex.get(entry.type)?.delete(memoryId);
    if (this.typeIndex.get(entry.type)?.size === 0)
      this.typeIndex.delete(entry.type);
    this.entries.delete(memoryId);
    return true;
  }

  search(query: IndexQuery): IndexEntry[] {
    let results = Array.from(this.entries.values());

    if (query.tags && query.tags.length > 0) {
      results = results.filter((e) =>
        query.tags!.some((t) => e.tags.includes(t))
      );
    }

    if (query.type) {
      results = results.filter((e) => e.type === query.type);
    }

    if (query.startTime !== undefined) {
      results = results.filter((e) => e.createdAt >= query.startTime!);
    }

    if (query.endTime !== undefined) {
      results = results.filter((e) => e.createdAt <= query.endTime!);
    }

    if (query.keyword) {
      const kw = query.keyword.toLowerCase();
      results = results.filter(
        (e) =>
          e.contentPreview.toLowerCase().includes(kw) ||
          e.tags.some((t) => t.toLowerCase().includes(kw))
      );
    }

    if (query.offset) results = results.slice(query.offset);
    if (query.limit) results = results.slice(0, query.limit);

    return results;
  }

  getByTag(tag: string): IndexEntry[] {
    const ids = this.tagIndex.get(tag);
    if (!ids) return [];
    return Array.from(ids)
      .map((id) => this.entries.get(id)!)
      .filter(Boolean);
  }

  getByType(type: string): IndexEntry[] {
    const ids = this.typeIndex.get(type);
    if (!ids) return [];
    return Array.from(ids)
      .map((id) => this.entries.get(id)!)
      .filter(Boolean);
  }

  getByTimeRange(start: number, end: number): IndexEntry[] {
    return Array.from(this.entries.values())
      .filter((e) => e.createdAt >= start && e.createdAt <= end)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  searchByKeyword(keyword: string, limit: number = 20): IndexEntry[] {
    const kw = keyword.toLowerCase();
    return Array.from(this.entries.values())
      .filter(
        (e) =>
          e.contentPreview.toLowerCase().includes(kw) ||
          e.tags.some((t) => t.toLowerCase().includes(kw))
      )
      .slice(0, limit);
  }

  getStats(): IndexStats {
    const byType: Record<string, number> = {};
    const byTag: Record<string, number> = {};
    for (const e of this.entries.values()) {
      byType[e.type] = (byType[e.type] || 0) + 1;
      for (const t of e.tags) {
        byTag[t] = (byTag[t] || 0) + 1;
      }
    }
    const times = Array.from(this.entries.values()).map((e) => e.createdAt);
    return {
      totalEntries: this.entries.size,
      byType,
      byTag,
      lastIndexedAt: times.length > 0 ? Math.max(...times) : 0,
    };
  }

  clear(): void {
    this.entries.clear();
    this.tagIndex.clear();
    this.typeIndex.clear();
  }
}
