import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fsp from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';

import {
  hasConfiguredMemorySecretInput,
  resolveMemorySecretInputString,
} from './secret.js';

import {
  resolveMemoryVectorState,
  resolveMemoryFtsState,
  resolveMemoryCacheSummary,
  resolveMemoryCacheState,
} from './status.js';

import { extractKeywords, isQueryStopWordToken } from './query.js';

import {
  appendMemoryHostEvent,
  readMemoryHostEvents,
  resolveMemoryHostEventLogPath,
} from './events.js';

import {
  DEFAULT_MEMORY_DREAMING_ENABLED,
  DEFAULT_MEMORY_DREAMING_FREQUENCY,
  DEFAULT_MEMORY_DREAMING_PLUGIN_ID,
  DEFAULT_MEMORY_LIGHT_DREAMING_LOOKBACK_DAYS,
  DEFAULT_MEMORY_DEEP_DREAMING_LIMIT,
  DEFAULT_MEMORY_REM_DREAMING_LOOKBACK_DAYS,
  resolveMemoryDreamingConfig,
  resolveMemoryDreamingPluginId,
  resolveMemoryDreamingPluginConfig,
} from './dreaming.js';

import type {
  MemorySearchResult,
  MemorySearchManager,
  MemoryProviderStatus,
} from './types.js';

describe('types', () => {
  it('should define MemorySearchResult with required fields', () => {
    const result: MemorySearchResult = {
      path: '/memory/test.md',
      startLine: 1,
      endLine: 10,
      score: 0.85,
      snippet: 'test content',
      source: 'memory',
    };
    expect(result.path).toBe('/memory/test.md');
    expect(result.score).toBe(0.85);
    expect(result.source).toBe('memory');
  });

  it('should define MemorySearchResult with optional fields', () => {
    const result: MemorySearchResult = {
      path: '/memory/test.md',
      startLine: 1,
      endLine: 10,
      score: 0.95,
      snippet: 'content',
      source: 'sessions',
      vectorScore: 0.9,
      textScore: 0.8,
      citation: '[1]',
    };
    expect(result.vectorScore).toBe(0.9);
    expect(result.textScore).toBe(0.8);
    expect(result.citation).toBe('[1]');
  });

  it('should define MemorySearchManager interface', async () => {
    const manager: MemorySearchManager = {
      async search(_query, _opts) {
        return [];
      },
      async readFile(_params) {
        return { text: 'content', path: '/test.md' };
      },
      status() {
        return {
          backend: 'builtin',
          provider: 'test',
          files: 10,
          chunks: 100,
        } as MemoryProviderStatus;
      },
      async probeEmbeddingAvailability() {
        return { ok: false };
      },
      async probeVectorAvailability() {
        return false;
      },
    };
    const results = await manager.search('test');
    expect(results).toEqual([]);
    const file = await manager.readFile({ relPath: '/test.md' });
    expect(file.text).toBe('content');
    expect(manager.status().provider).toBe('test');
    expect(await manager.probeEmbeddingAvailability()).toEqual({ ok: false });
    expect(await manager.probeVectorAvailability()).toBe(false);
  });
});

describe('secret', () => {
  const OLD_ENV = { ...process.env };

  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('hasConfiguredMemorySecretInput should return false for null/undefined', () => {
    expect(hasConfiguredMemorySecretInput(null)).toBe(false);
    expect(hasConfiguredMemorySecretInput(undefined)).toBe(false);
  });

  it('hasConfiguredMemorySecretInput should detect env source with matching env var', () => {
    process.env.TEST_MEMORY_KEY = 'my-secret-key';
    expect(
      hasConfiguredMemorySecretInput({ source: 'env', id: 'TEST_MEMORY_KEY' })
    ).toBe(true);
  });

  it('hasConfiguredMemorySecretInput should return false when env var missing', () => {
    expect(
      hasConfiguredMemorySecretInput({ source: 'env', id: 'MISSING_VAR_12345' })
    ).toBe(false);
  });

  it('hasConfiguredMemorySecretInput should detect direct value', () => {
    expect(hasConfiguredMemorySecretInput({ value: 'direct-key' })).toBe(true);
  });

  it('resolveMemorySecretInputString should resolve from env', () => {
    process.env.TEST_MEMORY_KEY = 'resolved-value';
    const result = resolveMemorySecretInputString({
      value: { source: 'env', id: 'TEST_MEMORY_KEY' },
      path: 'test.path',
    });
    expect(result).toBe('resolved-value');
  });

  it('resolveMemorySecretInputString should return undefined for missing env', () => {
    const result = resolveMemorySecretInputString({
      value: { source: 'env', id: 'MISSING_VAR_99999' },
      path: 'test.path',
    });
    expect(result).toBeUndefined();
  });

  it('resolveMemorySecretInputString should return direct string value', () => {
    const result = resolveMemorySecretInputString({
      value: 'inline-secret',
      path: 'test.path',
    });
    expect(result).toBe('inline-secret');
  });
});

describe('status', () => {
  it('resolveMemoryVectorState should return ready when enabled and available', () => {
    const result = resolveMemoryVectorState({ enabled: true, available: true });
    expect(result).toEqual({ tone: 'ok', state: 'ready' });
  });

  it('resolveMemoryVectorState should return disabled when not enabled', () => {
    const result = resolveMemoryVectorState({ enabled: false });
    expect(result).toEqual({ tone: 'muted', state: 'disabled' });
  });

  it('resolveMemoryVectorState should return unavailable when enabled but not available', () => {
    const result = resolveMemoryVectorState({
      enabled: true,
      available: false,
    });
    expect(result).toEqual({ tone: 'warn', state: 'unavailable' });
  });

  it('resolveMemoryFtsState should return ready when enabled and available', () => {
    const result = resolveMemoryFtsState({ enabled: true, available: true });
    expect(result).toEqual({ tone: 'ok', state: 'ready' });
  });

  it('resolveMemoryFtsState should return disabled when not enabled', () => {
    const result = resolveMemoryFtsState({ enabled: false, available: false });
    expect(result).toEqual({ tone: 'muted', state: 'disabled' });
  });

  it('resolveMemoryCacheSummary should format cache-on text with entries', () => {
    const result = resolveMemoryCacheSummary({ enabled: true, entries: 42 });
    expect(result).toEqual({ tone: 'ok', text: 'cache on (42)' });
  });

  it('resolveMemoryCacheSummary should format cache-off text', () => {
    const result = resolveMemoryCacheSummary({ enabled: false });
    expect(result).toEqual({ tone: 'muted', text: 'cache off' });
  });

  it('resolveMemoryCacheState should return enabled state', () => {
    const result = resolveMemoryCacheState({ enabled: true });
    expect(result).toEqual({ tone: 'ok', state: 'enabled' });
  });

  it('resolveMemoryCacheState should return disabled state', () => {
    const result = resolveMemoryCacheState({ enabled: false });
    expect(result).toEqual({ tone: 'muted', state: 'disabled' });
  });
});

describe('query', () => {
  it('extractKeywords should return empty for empty input', () => {
    expect(extractKeywords('')).toEqual([]);
    expect(extractKeywords('   ')).toEqual([]);
  });

  it('extractKeywords should filter out English stop words', () => {
    const result = extractKeywords('the quick brown fox');
    expect(result).not.toContain('the');
    expect(result).toContain('quick');
    expect(result).toContain('brown');
    expect(result).toContain('fox');
  });

  it('extractKeywords should filter out Chinese stop words', () => {
    const result = extractKeywords('的 方案 讨论');
    expect(result).not.toContain('的');
    expect(result).toContain('方案');
    expect(result).toContain('讨论');
  });

  it('extractKeywords should deduplicate tokens', () => {
    const result = extractKeywords('hello world hello');
    expect(result.filter((k) => k === 'hello').length).toBe(1);
    expect(result).toContain('world');
  });

  it('isQueryStopWordToken should return true for common stop words', () => {
    expect(isQueryStopWordToken('the')).toBe(true);
    expect(isQueryStopWordToken('的')).toBe(true);
    expect(isQueryStopWordToken('and')).toBe(true);
  });

  it('isQueryStopWordToken should return false for meaningful words', () => {
    expect(isQueryStopWordToken('typescript')).toBe(false);
    expect(isQueryStopWordToken('algorithm')).toBe(false);
    expect(isQueryStopWordToken('database')).toBe(false);
  });

  it('isQueryStopWordToken should return true for single characters', () => {
    expect(isQueryStopWordToken('a')).toBe(true);
    expect(isQueryStopWordToken('x')).toBe(true);
  });
});

describe('events', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'memory-host-test-'));
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('resolveMemoryHostEventLogPath should return correct path', () => {
    const result = resolveMemoryHostEventLogPath(tmpDir);
    expect(result).toBe(path.join(tmpDir, 'memory', '.dreams', 'events.jsonl'));
  });

  it('appendMemoryHostEvent should write event to file', async () => {
    const event = {
      type: 'memory.dream.completed' as const,
      timestamp: '2026-01-01T00:00:00.000Z',
      phase: 'light' as const,
      lineCount: 50,
      storageMode: 'separate' as const,
    };
    await appendMemoryHostEvent(tmpDir, event);
    const events = await readMemoryHostEvents({ workspaceDir: tmpDir });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('memory.dream.completed');
    if (events[0].type === 'memory.dream.completed') {
      expect(events[0].phase).toBe('light');
      expect(events[0].lineCount).toBe(50);
    }
  });

  it('readMemoryHostEvents should return empty array when no file', async () => {
    const events = await readMemoryHostEvents({ workspaceDir: tmpDir });
    expect(events).toEqual([]);
  });

  it('readMemoryHostEvents should respect limit parameter', async () => {
    for (let i = 0; i < 5; i++) {
      await appendMemoryHostEvent(tmpDir, {
        type: 'memory.recall.recorded',
        timestamp: `2026-01-0${i + 1}T00:00:00.000Z`,
        query: `query ${i}`,
        resultCount: i,
        results: [],
      });
    }
    const events = await readMemoryHostEvents({
      workspaceDir: tmpDir,
      limit: 3,
    });
    expect(events).toHaveLength(3);
  });

  it('appendMemoryHostEvent should handle promotion applied events', async () => {
    await appendMemoryHostEvent(tmpDir, {
      type: 'memory.promotion.applied',
      timestamp: '2026-01-01T00:00:00.000Z',
      memoryPath: '/memory/test.md',
      applied: 5,
      candidates: [
        {
          key: 'test-key',
          path: '/memory/test.md',
          startLine: 1,
          endLine: 10,
          score: 0.9,
          recallCount: 3,
        },
      ],
    });
    const events = await readMemoryHostEvents({ workspaceDir: tmpDir });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('memory.promotion.applied');
  });
});

describe('dreaming', () => {
  it('should export default constants', () => {
    expect(DEFAULT_MEMORY_DREAMING_ENABLED).toBe(false);
    expect(DEFAULT_MEMORY_DREAMING_FREQUENCY).toBe('0 3 * * *');
    expect(DEFAULT_MEMORY_DREAMING_PLUGIN_ID).toBe('memory-core');
    expect(DEFAULT_MEMORY_LIGHT_DREAMING_LOOKBACK_DAYS).toBe(2);
    expect(DEFAULT_MEMORY_DEEP_DREAMING_LIMIT).toBe(10);
    expect(DEFAULT_MEMORY_REM_DREAMING_LOOKBACK_DAYS).toBe(7);
  });

  it('resolveMemoryDreamingPluginId should return default when no config', () => {
    expect(resolveMemoryDreamingPluginId(undefined)).toBe('memory-core');
  });

  it('resolveMemoryDreamingPluginId should read from plugins.slots.memory', () => {
    const cfg = {
      plugins: {
        slots: { memory: 'custom-memory-plugin' },
      },
    };
    expect(resolveMemoryDreamingPluginId(cfg)).toBe('custom-memory-plugin');
  });

  it('resolveMemoryDreamingPluginId should return default when slot is none', () => {
    const cfg = {
      plugins: {
        slots: { memory: 'none' },
      },
    };
    expect(resolveMemoryDreamingPluginId(cfg)).toBe('memory-core');
  });

  it('resolveMemoryDreamingPluginConfig should return undefined when no config', () => {
    expect(resolveMemoryDreamingPluginConfig(undefined)).toBeUndefined();
  });

  it('resolveMemoryDreamingPluginConfig should extract plugin config', () => {
    const cfg = {
      plugins: {
        slots: { memory: 'my-plugin' },
        entries: {
          'my-plugin': {
            config: { dreaming: { enabled: true } },
          },
        },
      },
    };
    const result = resolveMemoryDreamingPluginConfig(cfg);
    expect(result).toEqual({ dreaming: { enabled: true } });
  });

  it('resolveMemoryDreamingConfig should return defaults with empty config', () => {
    const result = resolveMemoryDreamingConfig({});
    expect(result.enabled).toBe(DEFAULT_MEMORY_DREAMING_ENABLED);
    expect(result.frequency).toBe('0 3 * * *');
    expect(result.phases.light.enabled).toBe(true);
    expect(result.phases.deep.enabled).toBe(true);
    expect(result.phases.rem.enabled).toBe(true);
    expect(result.phases.light.execution.speed).toBe('fast');
    expect(result.phases.deep.execution.speed).toBe('balanced');
    expect(result.phases.rem.execution.speed).toBe('slow');
  });

  it('resolveMemoryDreamingConfig should apply overrides', () => {
    const result = resolveMemoryDreamingConfig({
      pluginConfig: {
        dreaming: {
          enabled: true,
          frequency: '0 */2 * * *',
          phases: {
            light: {
              lookbackDays: 5,
              limit: 50,
            },
            deep: {
              limit: 20,
              minScore: 0.7,
            },
          },
        },
      },
    });
    expect(result.enabled).toBe(true);
    expect(result.frequency).toBe('0 */2 * * *');
    expect(result.phases.light.lookbackDays).toBe(5);
    expect(result.phases.light.limit).toBe(50);
    expect(result.phases.deep.limit).toBe(20);
    expect(result.phases.deep.minScore).toBe(0.7);
  });

  it('resolveMemoryDreamingConfig should resolve timezone from cfg.agents.defaults', () => {
    const result = resolveMemoryDreamingConfig({
      cfg: {
        agents: {
          defaults: { userTimezone: 'Asia/Shanghai' },
        },
      },
    });
    expect(result.timezone).toBe('Asia/Shanghai');
  });

  it('resolveMemoryDreamingConfig should handle execution config overrides', () => {
    const result = resolveMemoryDreamingConfig({
      pluginConfig: {
        dreaming: {
          model: 'gpt-4',
          execution: {
            defaults: {
              speed: 'slow',
              thinking: 'high',
              budget: 'expensive',
              maxOutputTokens: 4096,
              temperature: 0.7,
            },
          },
        },
      },
    });
    expect(result.execution.defaults.model).toBe('gpt-4');
    expect(result.execution.defaults.speed).toBe('slow');
    expect(result.execution.defaults.maxOutputTokens).toBe(4096);
    expect(result.execution.defaults.temperature).toBe(0.7);
  });
});

describe('index barrel exports', () => {
  it('should export all expected types and functions', async () => {
    const mod = await import('./index.js');
    expect(typeof mod.hasConfiguredMemorySecretInput).toBe('function');
    expect(typeof mod.resolveMemorySecretInputString).toBe('function');
    expect(typeof mod.resolveMemoryVectorState).toBe('function');
    expect(typeof mod.resolveMemoryFtsState).toBe('function');
    expect(typeof mod.resolveMemoryCacheSummary).toBe('function');
    expect(typeof mod.extractKeywords).toBe('function');
    expect(typeof mod.isQueryStopWordToken).toBe('function');
    expect(typeof mod.appendMemoryHostEvent).toBe('function');
    expect(typeof mod.readMemoryHostEvents).toBe('function');
    expect(typeof mod.resolveMemoryHostEventLogPath).toBe('function');
    expect(typeof mod.resolveMemoryDreamingConfig).toBe('function');
    expect(typeof mod.resolveMemoryDreamingPluginId).toBe('function');
    expect(typeof mod.resolveMemoryDreamingPluginConfig).toBe('function');
  });
});

describe('engine barrel exports', () => {
  it('should re-export from types and dreaming', async () => {
    const mod = await import('./engine.js');
    expect(typeof mod.resolveMemoryDreamingConfig).toBe('function');
    expect(typeof mod.resolveMemoryDreamingPluginId).toBe('function');
  });
});

describe('runtime barrel exports', () => {
  it('should re-export from types, secret, status, and query', async () => {
    const mod = await import('./runtime.js');
    expect(typeof mod.hasConfiguredMemorySecretInput).toBe('function');
    expect(typeof mod.resolveMemorySecretInputString).toBe('function');
    expect(typeof mod.resolveMemoryVectorState).toBe('function');
    expect(typeof mod.resolveMemoryFtsState).toBe('function');
    expect(typeof mod.resolveMemoryCacheSummary).toBe('function');
    expect(typeof mod.extractKeywords).toBe('function');
    expect(typeof mod.isQueryStopWordToken).toBe('function');
  });
});
