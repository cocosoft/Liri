/**
 * EffectScope 单元测试
 *
 * 对齐方案 T1.1 测试清单 8 用例：
 * 1. LIFO 顺序
 * 2. 幂等（dispose 两次）
 * 3. 并发 dispose
 * 4. 子作用域
 * 5. 中断安全（effect 回调抛错）
 * 6. 逆操作抛错（continue-on-error + 聚合）
 * 7. dispose 后 onDispose 抛错
 * 8. 补偿登记统一 LIFO
 */

import { describe, test, expect } from 'bun:test';
import { EffectScope, EffectContext } from '../EffectScope.js';

describe('EffectScope', () => {
  describe('LIFO 顺序', () => {
    test('注册 A→B→C，dispose 顺序 C→B→A', async () => {
      const scope = new EffectScope();
      const order: string[] = [];
      scope.onDispose(() => order.push('A'));
      scope.onDispose(() => order.push('B'));
      scope.onDispose(() => order.push('C'));

      await scope.dispose();
      expect(order).toEqual(['C', 'B', 'A']);
    });
  });

  describe('幂等', () => {
    test('dispose 两次，逆操作只执行一次', async () => {
      const scope = new EffectScope();
      let count = 0;
      scope.onDispose(() => count++);

      await scope.dispose();
      await scope.dispose();
      expect(count).toBe(1);
    });
  });

  describe('并发 dispose', () => {
    test('两个同时 dispose()，链只执行一遍（await 间隙注入）', async () => {
      const scope = new EffectScope();
      let count = 0;
      scope.onDispose(async () => {
        count++;
        await new Promise((r) => setTimeout(r, 10));
      });

      const [a, b] = await Promise.all([scope.dispose(), scope.dispose()]);
      expect(a).toBeUndefined();
      expect(b).toBeUndefined();
      expect(count).toBe(1);
    });
  });

  describe('子作用域', () => {
    test('父 dispose 先回收子 scope 再执行父逆操作', async () => {
      const scope = new EffectScope();
      const order: string[] = [];

      const child = scope.child();
      child.onDispose(() => order.push('child'));
      scope.onDispose(() => order.push('parent'));

      await scope.dispose();
      expect(order).toEqual(['child', 'parent']);
    });

    test('子已提前 dispose 不重复执行', async () => {
      const scope = new EffectScope();
      const child = scope.child();
      let childCount = 0;
      child.onDispose(() => childCount++);

      await child.dispose();
      expect(childCount).toBe(1);

      await scope.dispose();
      expect(childCount).toBe(1);
    });
  });

  describe('中断安全', () => {
    test('effect 回调内抛错，已累积逆操作仍执行', async () => {
      const scope = new EffectScope();
      const released: string[] = [];

      scope.onDispose(() => released.push('before'));

      await expect(
        scope.effect(async () => {
          scope.onDispose(() => released.push('inside'));
          throw new Error('回调失败');
        })
      ).rejects.toThrow('回调失败');

      // 回调抛错不影响逆操作链
      await scope.dispose();
      expect(released).toEqual(['inside', 'before']);
    });
  });

  describe('逆操作抛错', () => {
    test('第 2 个逆操作抛错，第 3 个仍执行，错误被聚合上报', async () => {
      const scope = new EffectScope();
      const order: string[] = [];

      scope.onDispose(() => order.push('A'));
      scope.onDispose(() => {
        throw new Error('B 失败');
      });
      scope.onDispose(() => order.push('C'));

      await expect(scope.dispose()).rejects.toThrow(
        'EffectScope dispose 存在 1 个失败的逆操作'
      );
      // continue-on-error：C 仍执行（LIFO 中 C 在 B 之后注册、先于 B 执行，
      // B 失败后 A 仍执行）
      expect(order).toEqual(['C', 'A']);
    });
  });

  describe('use-after-dispose', () => {
    test('dispose 后 onDispose → 抛错', async () => {
      const scope = new EffectScope();
      await scope.dispose();

      expect(() => scope.onDispose(() => {})).toThrow('use-after-dispose');
      expect(() => scope.child()).toThrow('use-after-dispose');
    });
  });

  describe('补偿登记', () => {
    test('onDispose 与 effect 逆操作按注册顺序统一 LIFO', async () => {
      const scope = new EffectScope();
      const order: string[] = [];

      scope.onDispose(() => order.push('outer-1'));

      await scope.effect(async (ctx: EffectContext) => {
        ctx.onDispose(() => order.push('inner-2'));
        ctx.onDispose(() => order.push('inner-3'));
      });

      scope.onDispose(() => order.push('outer-4'));

      await scope.dispose();
      // 注册顺序 outer-1 → inner-2 → inner-3 → outer-4
      // LIFO 释放顺序 outer-4 → inner-3 → inner-2 → outer-1
      expect(order).toEqual(['outer-4', 'inner-3', 'inner-2', 'outer-1']);
    });
  });

  describe('泄漏监控（v4.3 §D）', () => {
    test('活跃 scope 计数：构造 +1，dispose 后 -1', async () => {
      const before = EffectScope.getActiveCount();
      const scope = new EffectScope();
      expect(EffectScope.getActiveCount()).toBe(before + 1);

      await scope.dispose();
      expect(EffectScope.getActiveCount()).toBe(before);
    });

    test('子 scope 释放独立递减计数', async () => {
      const before = EffectScope.getActiveCount();
      const parent = new EffectScope();
      const child = parent.child();
      expect(EffectScope.getActiveCount()).toBe(before + 2);

      await child.dispose();
      expect(EffectScope.getActiveCount()).toBe(before + 1);

      await parent.dispose();
      expect(EffectScope.getActiveCount()).toBe(before);
    });
  });
});
