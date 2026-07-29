// MIT License
// Copyright (c) 2026 190615273@qq.com

// P1-4: 外部记忆提供商单元测试
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { HonchoMemoryProvider } from '../../src/memory/providers/HonchoMemoryProvider';
import { Mem0MemoryProvider } from '../../src/memory/providers/Mem0MemoryProvider';

describe('HonchoMemoryProvider', () => {
  let savedApiKey: string | undefined;
  let savedBaseUrl: string | undefined;

  beforeEach(() => {
    savedApiKey = process.env.HONCHO_API_KEY;
    savedBaseUrl = process.env.HONCHO_BASE_URL;
    delete process.env.HONCHO_API_KEY;
    delete process.env.HONCHO_BASE_URL;
  });

  afterEach(() => {
    if (savedApiKey) process.env.HONCHO_API_KEY = savedApiKey;
    else delete process.env.HONCHO_API_KEY;
    if (savedBaseUrl) process.env.HONCHO_BASE_URL = savedBaseUrl;
    else delete process.env.HONCHO_BASE_URL;
  });

  it('has correct id and displayName', () => {
    const provider = new HonchoMemoryProvider();
    expect(provider.id).toBe('honcho');
    expect(provider.displayName).toBe('Honcho');
  });

  it('fails health check without API key', async () => {
    const provider = new HonchoMemoryProvider();
    const ok = await provider.healthCheck();
    expect(ok).toBe(false);
  });

  it('returns empty when fetchAllMemories without initialization', async () => {
    const provider = new HonchoMemoryProvider();
    const results = await provider.fetchAllMemories({ limit: 5 });
    expect(results).toEqual([]);
  });

  it('returns null when fetchMemoryById without initialization', async () => {
    const provider = new HonchoMemoryProvider();
    const result = await provider.fetchMemoryById('123');
    expect(result).toBeNull();
  });

  it('does not throw on syncMemories without initialization', async () => {
    const provider = new HonchoMemoryProvider();
    await provider.syncMemories([
      {
        id: '1',
        content: 'test',
        tags: [],
        priority: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        metadata: {},
      },
    ]);
  });

  it('uses constructor config over defaults', () => {
    const provider = new HonchoMemoryProvider({
      apiKey: 'test-key',
      baseUrl: 'http://localhost:9999',
      timeoutMs: 5000,
      maxRetries: 1,
    });
    expect(provider.id).toBe('honcho');
  });

  it('shutdown succeeds without initialization', async () => {
    const provider = new HonchoMemoryProvider();
    await provider.shutdown();
  });
});

describe('Mem0MemoryProvider', () => {
  let savedApiKey: string | undefined;
  let savedBaseUrl: string | undefined;

  beforeEach(() => {
    savedApiKey = process.env.MEM0_API_KEY;
    savedBaseUrl = process.env.MEM0_BASE_URL;
    delete process.env.MEM0_API_KEY;
    delete process.env.MEM0_BASE_URL;
  });

  afterEach(() => {
    if (savedApiKey) process.env.MEM0_API_KEY = savedApiKey;
    else delete process.env.MEM0_API_KEY;
    if (savedBaseUrl) process.env.MEM0_BASE_URL = savedBaseUrl;
    else delete process.env.MEM0_BASE_URL;
  });

  it('has correct id and displayName', () => {
    const provider = new Mem0MemoryProvider();
    expect(provider.id).toBe('mem0');
    expect(provider.displayName).toBe('Mem0');
  });

  it('fails health check without API key', async () => {
    const provider = new Mem0MemoryProvider();
    const ok = await provider.healthCheck();
    expect(ok).toBe(false);
  });

  it('returns empty when fetchAllMemories without initialization', async () => {
    const provider = new Mem0MemoryProvider();
    const results = await provider.fetchAllMemories({ limit: 5 });
    expect(results).toEqual([]);
  });

  it('returns null when fetchMemoryById without initialization', async () => {
    const provider = new Mem0MemoryProvider();
    const result = await provider.fetchMemoryById('123');
    expect(result).toBeNull();
  });

  it('does not throw on syncMemories without initialization', async () => {
    const provider = new Mem0MemoryProvider();
    await provider.syncMemories([
      {
        id: '1',
        content: 'test',
        tags: [],
        priority: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        metadata: {},
      },
    ]);
  });

  it('uses constructor config over defaults', () => {
    const provider = new Mem0MemoryProvider({
      apiKey: 'test-key',
      baseUrl: 'http://localhost:9999',
      timeoutMs: 5000,
      maxRetries: 1,
    });
    expect(provider.id).toBe('mem0');
  });

  it('shutdown succeeds without initialization', async () => {
    const provider = new Mem0MemoryProvider();
    await provider.shutdown();
  });
});
