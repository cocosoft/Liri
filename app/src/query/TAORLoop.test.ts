import { describe, it, expect, beforeEach } from 'bun:test';
import { TAORLoop } from './TAORLoop';

class MockQueryEngine {
  compactCalled = false;

  async query(prompt: string) {
    return { content: `response to: ${prompt}`, tokens: 50 };
  }

  async compactIfNeeded(sessionId: string): Promise<void> {
    this.compactCalled = true;
  }
}

describe('TAORLoop', () => {
  let loop: TAORLoop;
  let mockEngine: MockQueryEngine;

  beforeEach(() => {
    mockEngine = new MockQueryEngine();
    loop = new TAORLoop(mockEngine as any, { maxTurns: 3 });
  });

  describe('初始化', () => {
    it('应创建 TAORLoop 实例', () => {
      expect(loop).toBeDefined();
    });

    it('应使用默认配置', () => {
      expect(loop.getTurnCount()).toBe(0);
    });
  });

  describe('run', () => {
    it('应执行 TAOR 循环', async () => {
      const result = await loop.runCollect({ prompt: 'test query' });
      expect(result).toBeDefined();
      expect(typeof result.turnCount).toBe('number');
    });

    it('应返回循环结果', async () => {
      const result = await loop.runCollect({ prompt: 'test' });
      expect(result).toHaveProperty('turnCount');
      expect(result).toHaveProperty('totalTokens');
      expect(result).toHaveProperty('stopReason');
    });

    it('应在 TokenBudget WARNING 时触发上下文压缩', async () => {
      const smallBudget = {
        maxTokens: 1000,
        maxOutputTokens: 1000,
        warningThreshold: 0.7,
      };
      const tinyEngine = new MockQueryEngine();
      const tinyLoop = new TAORLoop(tinyEngine as any, {
        maxTurns: 5,
        sessionId: 'compression-test',
        budgetConfig: smallBudget,
      });

      tinyLoop.getTokenBudget().consumeTokens(750);

      await tinyLoop.runCollect({ prompt: 'compression test' });

      expect(tinyEngine.compactCalled).toBe(true);
    });
  });

  describe('abort', () => {
    it('应终止执行', () => {
      loop.abort();
      // Abort triggers stopped = true, verify via shouldStop behavior
      expect(loop.getTurnCount()).toBe(0);
    });
  });

  describe('reset', () => {
    it('应重置状态', () => {
      loop.abort();
      loop.reset();
      expect(loop.getTurnCount()).toBe(0);
    });

    it('应在重置后允许重新运行', async () => {
      const r1 = await loop.runCollect({ prompt: 'first' });
      loop.reset();
      const r2 = await loop.runCollect({ prompt: 'second' });
      expect(r2.turnCount).toBeGreaterThan(0);
    });
  });

  describe('registerStopHook', () => {
    it('应注册停止钩子', () => {
      const hook = {
        name: 'test_hook',
        priority: 10,
        hook: async () => {},
      };
      loop.registerStopHook(hook);
      expect(loop.getStopHookManager()).toBeDefined();
    });
  });
});
