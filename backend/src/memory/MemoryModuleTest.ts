import { describe, it, expect, beforeEach } from 'bun:test';
import { MemoryIndexer } from './indexer/MemoryIndexer';
import type { IndexEntry } from './indexer/MemoryIndexer';
import { MemoryPriorityManager, PriorityTier, calculateScore, scoreToTier } from './priority/MemoryPriorityManager';
import type { PriorityFactor } from './priority/MemoryPriorityManager';
import { MemoryConsolidator } from './consolidation/MemoryConsolidator';
import type { MergeCandidate } from './consolidation/MemoryConsolidator';

describe('MemoryIndexer', () => {
  let indexer: MemoryIndexer;

  beforeEach(() => {
    indexer = new MemoryIndexer();
  });

  it('indexes a single entry', () => {
    const entry: IndexEntry = {
      memoryId: 'mem1', tags: ['tag1'], type: 'note',
      createdAt: Date.now(), updatedAt: Date.now(),
      contentHash: 'abc', contentPreview: 'hello world',
    };
    indexer.index(entry);
    expect(indexer.getStats().totalEntries).toBe(1);
  });

  it('batch indexes entries', () => {
    const entries: IndexEntry[] = [
      { memoryId: 'a', tags: ['t1'], type: 'note', createdAt: 100, updatedAt: 100, contentHash: 'h1', contentPreview: 'first' },
      { memoryId: 'b', tags: ['t2'], type: 'task', createdAt: 200, updatedAt: 200, contentHash: 'h2', contentPreview: 'second' },
    ];
    indexer.batchIndex(entries);
    expect(indexer.getStats().totalEntries).toBe(2);
  });

  it('removes an entry', () => {
    const entry: IndexEntry = {
      memoryId: 'remove-me', tags: ['x'], type: 'note',
      createdAt: Date.now(), updatedAt: Date.now(),
      contentHash: 'x', contentPreview: 'remove',
    };
    indexer.index(entry);
    expect(indexer.remove('remove-me')).toBe(true);
    expect(indexer.getStats().totalEntries).toBe(0);
  });

  it('returns false when removing non-existent entry', () => {
    expect(indexer.remove('ghost')).toBe(false);
  });

  it('searches by tag', () => {
    indexer.batchIndex([
      { memoryId: 'a', tags: ['important'], type: 'note', createdAt: 100, updatedAt: 100, contentHash: 'h1', contentPreview: 'a' },
      { memoryId: 'b', tags: ['normal'], type: 'note', createdAt: 200, updatedAt: 200, contentHash: 'h2', contentPreview: 'b' },
    ]);
    const results = indexer.getByTag('important');
    expect(results.length).toBe(1);
    expect(results[0].memoryId).toBe('a');
  });

  it('searches by type', () => {
    indexer.batchIndex([
      { memoryId: 'a', tags: [], type: 'note', createdAt: 100, updatedAt: 100, contentHash: 'h1', contentPreview: 'a' },
      { memoryId: 'b', tags: [], type: 'task', createdAt: 200, updatedAt: 200, contentHash: 'h2', contentPreview: 'b' },
    ]);
    const results = indexer.getByType('task');
    expect(results.length).toBe(1);
    expect(results[0].memoryId).toBe('b');
  });

  it('searches by time range', () => {
    indexer.batchIndex([
      { memoryId: 'old', tags: [], type: 'note', createdAt: 100, updatedAt: 100, contentHash: 'h1', contentPreview: 'old' },
      { memoryId: 'new', tags: [], type: 'note', createdAt: 300, updatedAt: 300, contentHash: 'h2', contentPreview: 'new' },
    ]);
    const results = indexer.getByTimeRange(150, 400);
    expect(results.length).toBe(1);
    expect(results[0].memoryId).toBe('new');
  });

  it('searches by keyword', () => {
    indexer.batchIndex([
      { memoryId: 'a', tags: [], type: 'note', createdAt: 100, updatedAt: 100, contentHash: 'h1', contentPreview: 'apple banana' },
      { memoryId: 'b', tags: [], type: 'note', createdAt: 200, updatedAt: 200, contentHash: 'h2', contentPreview: 'cherry date' },
    ]);
    const results = indexer.searchByKeyword('apple');
    expect(results.length).toBe(1);
    expect(results[0].memoryId).toBe('a');
  });

  it('supports compound search', () => {
    indexer.batchIndex([
      { memoryId: 'a', tags: ['work'], type: 'note', createdAt: 100, updatedAt: 100, contentHash: 'h1', contentPreview: 'project report' },
      { memoryId: 'b', tags: ['personal'], type: 'note', createdAt: 200, updatedAt: 200, contentHash: 'h2', contentPreview: 'shopping list' },
    ]);
    const results = indexer.search({ tags: ['work'], keyword: 'report' });
    expect(results.length).toBe(1);
    expect(results[0].memoryId).toBe('a');
  });

  it('generates index stats', () => {
    indexer.batchIndex([
      { memoryId: 'a', tags: ['urgent', 'work'], type: 'note', createdAt: 100, updatedAt: 100, contentHash: 'h1', contentPreview: 'urgent note' },
      { memoryId: 'b', tags: ['work'], type: 'task', createdAt: 200, updatedAt: 200, contentHash: 'h2', contentPreview: 'work task' },
    ]);
    const stats = indexer.getStats();
    expect(stats.totalEntries).toBe(2);
    expect(stats.byType['note']).toBe(1);
    expect(stats.byType['task']).toBe(1);
    expect(stats.byTag['urgent']).toBe(1);
    expect(stats.byTag['work']).toBe(2);
  });

  it('clears all data', () => {
    indexer.batchIndex([
      { memoryId: 'a', tags: [], type: 'note', createdAt: 100, updatedAt: 100, contentHash: 'h1', contentPreview: 'a' },
    ]);
    indexer.clear();
    expect(indexer.getStats().totalEntries).toBe(0);
  });
});

describe('MemoryPriorityManager', () => {
  let manager: MemoryPriorityManager;

  beforeEach(() => {
    manager = new MemoryPriorityManager();
  });

  it('assigns critical priority for high scores', () => {
    const factors: PriorityFactor[] = [
      { name: 'importance', weight: 1, value: 1 },
    ];
    const priority = manager.assignPriority('mem1', factors);
    expect(priority.tier).toBe(PriorityTier.CRITICAL);
    expect(priority.score).toBeCloseTo(1, 2);
  });

  it('assigns archive priority for low scores', () => {
    const factors: PriorityFactor[] = [
      { name: 'importance', weight: 1, value: 0.1 },
    ];
    const priority = manager.assignPriority('mem1', factors);
    expect(priority.tier).toBe(PriorityTier.ARCHIVE);
  });

  it('assigns medium priority for medium scores', () => {
    const factors: PriorityFactor[] = [
      { name: 'importance', weight: 1, value: 0.55 },
    ];
    const priority = manager.assignPriority('mem1', factors);
    expect(priority.tier).toBe(PriorityTier.MEDIUM);
  });

  it('retrieves priority by memory id', () => {
    manager.assignPriority('find-me', [{ name: 'w', weight: 1, value: 0.8 }]);
    const result = manager.getPriority('find-me');
    expect(result).toBeDefined();
    expect(result!.memoryId).toBe('find-me');
  });

  it('returns undefined for unknown priority', () => {
    expect(manager.getPriority('ghost')).toBeUndefined();
  });

  it('updates existing priority', () => {
    manager.assignPriority('updatable', [{ name: 'w', weight: 1, value: 0.5 }]);
    const updated = manager.updatePriority('updatable', [{ name: 'w', weight: 1, value: 0.95 }]);
    expect(updated.tier).toBe(PriorityTier.CRITICAL);
    const retrieved = manager.getPriority('updatable');
    expect(retrieved!.tier).toBe(PriorityTier.CRITICAL);
  });

  it('batch assigns priorities', () => {
    const results = manager.batchAssignPriorities([
      { memoryId: 'a', factors: [{ name: 'w', weight: 1, value: 0.9 }] },
      { memoryId: 'b', factors: [{ name: 'w', weight: 1, value: 0.3 }] },
    ]);
    expect(results.length).toBe(2);
    expect(results[0].tier).toBe(PriorityTier.CRITICAL);
    expect(results[1].tier).toBe(PriorityTier.LOW);
  });

  it('lists memories by tier', () => {
    manager.batchAssignPriorities([
      { memoryId: 'c1', factors: [{ name: 'w', weight: 1, value: 0.95 }] },
      { memoryId: 'c2', factors: [{ name: 'w', weight: 1, value: 0.92 }] },
      { memoryId: 'low', factors: [{ name: 'w', weight: 1, value: 0.15 }] },
    ]);
    const criticals = manager.getMemoriesByTier(PriorityTier.CRITICAL);
    expect(criticals.length).toBe(2);
    expect(criticals).toContain('c1');
    expect(criticals).toContain('c2');
  });

  it('recalculates all priorities', () => {
    manager.batchAssignPriorities([
      { memoryId: 'a', factors: [{ name: 'w', weight: 1, value: 0.5 }] },
    ]);
    manager.getPriority('a')!.factors[0].value = 0.95;
    const changed = manager.recalculateAll();
    expect(changed).toBe(1);
    expect(manager.getPriority('a')!.tier).toBe(PriorityTier.CRITICAL);
  });

  it('generates tier distribution', () => {
    manager.batchAssignPriorities([
      { memoryId: 'a', factors: [{ name: 'w', weight: 1, value: 0.95 }] },
      { memoryId: 'b', factors: [{ name: 'w', weight: 1, value: 0.5 }] },
    ]);
    const dist = manager.getTierDistribution();
    expect(dist[PriorityTier.CRITICAL]).toBe(1);
    expect(dist[PriorityTier.MEDIUM]).toBe(1);
    expect(dist[PriorityTier.HIGH]).toBe(0);
  });

  it('clears all priorities', () => {
    manager.assignPriority('a', [{ name: 'w', weight: 1, value: 0.5 }]);
    manager.clear();
    expect(manager.getPriority('a')).toBeUndefined();
  });
});

describe('calculateScore', () => {
  it('returns 0 for empty factors', () => {
    expect(calculateScore([])).toBe(0);
  });

  it('computes weighted average correctly', () => {
    const factors: PriorityFactor[] = [
      { name: 'a', weight: 2, value: 1 },
      { name: 'b', weight: 3, value: 0 },
    ];
    expect(calculateScore(factors)).toBeCloseTo(0.4, 2);
  });
});

describe('scoreToTier', () => {
  it('maps scores to correct tiers', () => {
    expect(scoreToTier(0.95)).toBe(PriorityTier.CRITICAL);
    expect(scoreToTier(0.8)).toBe(PriorityTier.HIGH);
    expect(scoreToTier(0.55)).toBe(PriorityTier.MEDIUM);
    expect(scoreToTier(0.3)).toBe(PriorityTier.LOW);
    expect(scoreToTier(0.1)).toBe(PriorityTier.ARCHIVE);
  });
});

describe('MemoryConsolidator', () => {
  let consolidator: MemoryConsolidator;

  beforeEach(() => {
    consolidator = new MemoryConsolidator({ similarityThreshold: 0.3 });
  });

  it('finds merge candidates for similar memories', () => {
    const memories = [
      { id: 'a', content: 'the quick brown fox jumps over the lazy dog', tags: ['animal'], createdAt: 100 },
      { id: 'b', content: 'the quick brown fox jumps over the lazy cat', tags: ['pet'], createdAt: 200 },
    ];
    const candidates = consolidator.findMergeCandidates(memories);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].sourceIds).toContain('a');
    expect(candidates[0].sourceIds).toContain('b');
  });

  it('returns empty for dissimilar memories', () => {
    consolidator = new MemoryConsolidator({ similarityThreshold: 0.9 });
    const memories = [
      { id: 'a', content: 'hello world this is a test', tags: [], createdAt: 100 },
      { id: 'b', content: 'completely unrelated content here', tags: [], createdAt: 200 },
    ];
    const candidates = consolidator.findMergeCandidates(memories);
    expect(candidates.length).toBe(0);
  });

  it('merges candidates correctly', () => {
    const candidate: MergeCandidate = {
      sourceIds: ['a', 'b'],
      targetContent: 'merged content',
      mergedTags: ['tag1', 'tag2'],
      confidence: 0.8,
      reason: 'similarity test',
    };
    const result = consolidator.merge(candidate);
    expect(result.mergedCount).toBe(2);
    expect(result.removedIds).toEqual(['a', 'b']);
    expect(result.createdId).toMatch(/^merged_/);
    expect(result.confidence).toBe(0.8);
  });

  it('finds duplicates', () => {
    const memories = [
      { id: 'a', content: 'the quick brown fox jumps over the lazy dog', createdAt: 100 },
      { id: 'b', content: 'the quick brown fox jumps over the lazy dog', createdAt: 200 },
      { id: 'c', content: 'completely different content here', createdAt: 300 },
    ];
    const result = consolidator.findDuplicates(memories);
    expect(result.duplicates.length).toBeGreaterThan(0);
    expect(result.totalRemoved).toBeGreaterThan(0);
  });

  it('tracks consolidation stats', () => {
    const candidate: MergeCandidate = {
      sourceIds: ['x', 'y'],
      targetContent: 'test',
      mergedTags: [],
      confidence: 0.5,
      reason: 'test',
    };
    consolidator.merge(candidate);
    const stats = consolidator.getStats();
    expect(stats.totalMerged).toBe(1);
    expect(stats.totalRemoved).toBe(2);
    expect(stats.lastMergeTime).toBeGreaterThan(0);
  });

  it('respected max merge batch limit', () => {
    consolidator = new MemoryConsolidator({ similarityThreshold: 1, maxMergeBatch: 1 });
    const memories = [
      { id: 'a', content: 'exact same content for testing', tags: [], createdAt: 100 },
      { id: 'b', content: 'exact same content for testing', tags: [], createdAt: 200 },
      { id: 'c', content: 'exact same content for testing', tags: [], createdAt: 300 },
    ];
    const candidates = consolidator.findMergeCandidates(memories);
    expect(candidates.length).toBeLessThanOrEqual(1);
  });
});

describe('Memory Integration', () => {
  it('indexes priorities and retrieves by tier', () => {
    const indexer = new MemoryIndexer();
    const priorityManager = new MemoryPriorityManager();

    priorityManager.assignPriority('m1', [{ name: 'importance', weight: 1, value: 0.95 }]);
    priorityManager.assignPriority('m2', [{ name: 'importance', weight: 1, value: 0.3 }]);

    indexer.batchIndex([
      { memoryId: 'm1', tags: ['critical'], type: 'note', createdAt: 100, updatedAt: 100, contentHash: 'h1', contentPreview: 'critical memory' },
      { memoryId: 'm2', tags: ['low'], type: 'archive', createdAt: 200, updatedAt: 200, contentHash: 'h2', contentPreview: 'low priority' },
    ]);

    const criticalIds = priorityManager.getMemoriesByTier(PriorityTier.CRITICAL);
    expect(criticalIds).toContain('m1');

    const urgentResults = indexer.getByTag('critical');
    expect(urgentResults.length).toBe(1);
  });

  it('consolidation removes duplicates and indexing reflects removal', () => {
    const indexer = new MemoryIndexer();
    const consolidator = new MemoryConsolidator({ similarityThreshold: 0.8 });

    const memories = [
      { id: 'd1', content: 'duplicate content for merge testing purposes', tags: ['dup'], createdAt: 100 },
      { id: 'd2', content: 'duplicate content for merge testing purposes', tags: ['dup'], createdAt: 200 },
    ];

    const dedup = consolidator.findDuplicates(memories);
    expect(dedup.totalRemoved).toBeGreaterThan(0);

    const keepId = memories[0].id;
    indexer.batchIndex([
      { memoryId: keepId, tags: ['dup'], type: 'note', createdAt: 100, updatedAt: 100, contentHash: 'h1', contentPreview: memories[0].content },
    ]);
    expect(indexer.getStats().totalEntries).toBe(1);
    expect(indexer.searchByKeyword('duplicate').length).toBe(1);
  });
});
