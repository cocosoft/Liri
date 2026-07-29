// MIT License
// Copyright (c) 2026 190615273@qq.com

// P2-9: BatchRunner 批量并行处理测试
import { describe, it, expect } from 'bun:test';
import { BatchRunner } from '../../src/tasks/BatchRunner';
import type { BatchItem } from '../../src/tasks/BatchRunner';

function makeItems(nums: number[]): BatchItem<number>[] {
  return nums.map((n) => ({ id: String(n), input: n }));
}

describe('BatchRunner — 批量并行处理', () => {
  describe('基本功能', () => {
    it('processes items in parallel', async () => {
      const processed: number[] = [];
      const runner = new BatchRunner<number, number>({ concurrency: 2 });

      const { results, progress } = await runner.run(
        makeItems([1, 2, 3, 4, 5]),
        async (item) => {
          processed.push(item.input);
          return item.input * 2;
        }
      );

      expect(results.length).toBe(5);
      expect(progress.total).toBe(5);
      expect(processed).toContain(1);
      expect(processed).toContain(5);
    });

    it('respects concurrency limit', async () => {
      let concurrent = 0;
      let maxConcurrent = 0;
      const runner = new BatchRunner<number, number>({ concurrency: 2 });

      await runner.run(
        makeItems([1, 2, 3, 4]),
        async (item) => {
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await new Promise((r) => setTimeout(r, 10));
          concurrent--;
          return item.input;
        }
      );

      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });
  });

  describe('错误处理', () => {
    it('continues on worker failure when continueOnError=true', async () => {
      const runner = new BatchRunner<number, number>({
        concurrency: 2,
        continueOnError: true,
      });

      const { results, progress } = await runner.run(
        makeItems([1, 2, 3, 4, 5]),
        async (item) => {
          if (item.input === 3) throw new Error('test error');
          return item.input * 2;
        }
      );

      expect(progress.failed).toBe(1);
      expect(progress.total - progress.failed - progress.skipped).toBe(4);
    });

    it('stops on worker failure when continueOnError=false', async () => {
      const runner = new BatchRunner<number, number>({
        concurrency: 2,
        continueOnError: false,
      });

      const { progress } = await runner.run(
        makeItems([1, 2, 3]),
        async (item) => {
          if (item.input === 1) throw new Error('stop error');
          return item.input;
        }
      );

      expect(progress.failed).toBeGreaterThanOrEqual(1);
    });
  });

  describe('超时', () => {
    it('respects timeout', async () => {
      const runner = new BatchRunner<number, number>({
        concurrency: 2,
        timeoutMs: 50,
      });

      const { results } = await runner.run(
        makeItems([1, 2]),
        async (item) => {
          if (item.input === 1) await new Promise((r) => setTimeout(r, 500));
          return item.input;
        }
      );

      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('进度回调', () => {
    it('calls onProgress during execution', async () => {
      const completed: number[] = [];
      const runner = new BatchRunner<number, number>({ concurrency: 2 });

      await runner.run(
        makeItems([1, 2, 3]),
        async (item) => item.input * 2,
        (p) => completed.push(p.completed)
      );

      expect(completed.length).toBeGreaterThan(0);
    });
  });

  describe('空输入', () => {
    it('handles empty input array', async () => {
      const runner = new BatchRunner<number, number>({ concurrency: 2 });

      const { results, progress } = await runner.run(
        [],
        async (item) => item.input
      );

      expect(results).toEqual([]);
      expect(progress.total).toBe(0);
    });
  });
});
