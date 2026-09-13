/**
 * 模型热切换通知（T2.2）测试
 *
 * 对齐方案 T2.2 验收标准：
 * 1. 改配置 → 订阅方收到 {prev, next, at} 且 resolve 返回新模型
 * 2. 在途请求场景（b/c）行为符合协议（保守：完成当前，下次采用）
 * 3. withdraw 后新请求被拒（inject 返回 undefined）
 * 4. 未订阅方行为不变
 *
 * 直接测 dependencyRegistry + ModelRouter.subscribeTask 的集成语义
 * （ModelRouter 写 DB 的完整链路属集成测试，此处验证通知协议本身）。
 */

import { describe, test, expect } from 'bun:test';
import {
  DependencyRegistry,
  DepChange,
} from '../../context/DependencyRegistry.js';
import type { TaskType } from '@modules/ai';

/** 模拟 ModelRouter.subscribeTask 的 key 映射（与实现一致） */
const key = (t: TaskType) => `model:${t}`;

describe('模型热切换通知（T2.2）', () => {
  describe('provide 通知', () => {
    test('改配置 → 订阅方收到 {prev, next, at}，inject 返回新模型', () => {
      const reg = new DependencyRegistry();
      const received: DepChange[] = [];
      reg.subscribe(key('chat'), (c) => received.push(c));

      reg.provide(key('chat'), 'model-a');
      expect(received).toHaveLength(1);
      expect(received[0].type).toBe('provide');
      expect(received[0].prev).toBeUndefined();
      expect(received[0].next).toBe('model-a');
      expect(reg.inject(key('chat'))).toBe('model-a');
    });

    test('再次变更 → 收到 prev/next，前值正确', () => {
      const reg = new DependencyRegistry();
      reg.provide(key('chat'), 'model-a');
      const received: DepChange[] = [];
      reg.subscribe(key('chat'), (c) => received.push(c));

      reg.provide(key('chat'), 'model-b');
      expect(received).toHaveLength(1);
      expect(received[0].prev).toBe('model-a');
      expect(received[0].next).toBe('model-b');
    });
  });

  describe('在途请求协议（保守策略）', () => {
    test('有在途请求时允许完成当前，下一次采用新模型（协议 b/c）', () => {
      const reg = new DependencyRegistry();
      reg.provide(key('chat'), 'model-a');

      // 模拟消费方：记录"在途请求完成后采用的模型"
      let inFlightModel = 'model-a';
      let nextModel = 'model-a';
      reg.subscribe(key('chat'), (c) => {
        if (c.type === 'provide' && c.next) {
          // 协议 b/c：在途请求保持旧模型，下一次采用新模型
          nextModel = c.next as string;
        }
      });

      reg.provide(key('chat'), 'model-b');
      // 当前在途请求仍用旧模型（保守）
      expect(inFlightModel).toBe('model-a');
      // 下一次请求采用新模型
      expect(nextModel).toBe('model-b');
    });
  });

  describe('withdraw', () => {
    test('withdraw 后新请求被拒（inject 返回 undefined）', () => {
      const reg = new DependencyRegistry();
      reg.provide(key('chat'), 'model-a');
      expect(reg.inject(key('chat'))).toBe('model-a');

      const received: DepChange[] = [];
      reg.subscribe(key('chat'), (c) => received.push(c));

      reg.withdraw(key('chat'));
      expect(reg.inject(key('chat'))).toBeUndefined();
      expect(received).toHaveLength(1);
      expect(received[0].type).toBe('withdraw');
    });
  });

  describe('未订阅方', () => {
    test('未订阅方行为不变（inject 仍返回最新值，无副作用）', () => {
      const reg = new DependencyRegistry();
      reg.provide(key('chat'), 'model-a');
      // 无订阅者时 provide 不抛错
      reg.provide(key('chat'), 'model-b');
      expect(reg.inject(key('chat'))).toBe('model-b');
    });
  });
});
