/**
 * DependencyRegistry 单元测试（T2.1）
 *
 * 对齐方案 T2.1 测试清单 6 用例：
 * 1. provide 通知
 * 2. 值未变（Object.is）不通知
 * 3. withdraw 先通知再移除
 * 4. 未就绪 inject 返回 undefined
 * 5. 订阅回调抛错隔离
 * 6. 订阅 unsub 后不再收到通知
 */

import { describe, test, expect } from 'bun:test';
import { DependencyRegistry, DepChange } from '../DependencyRegistry.js';

describe('DependencyRegistry', () => {
  describe('provide', () => {
    test('provide 通知订阅者新值', () => {
      const reg = new DependencyRegistry();
      const received: DepChange[] = [];
      reg.subscribe('model:chat', (c) => received.push(c));

      reg.provide('model:chat', { id: 'm1' });

      expect(received).toHaveLength(1);
      expect(received[0].type).toBe('provide');
      expect(received[0].next).toEqual({ id: 'm1' });
      expect(received[0].prev).toBeUndefined();
      expect(reg.inject('model:chat')).toEqual({ id: 'm1' });
    });
  });

  describe('Object.is 值比较', () => {
    test('值未变不通知（同一引用）', () => {
      const reg = new DependencyRegistry();
      const obj = { id: 'm1' };
      reg.provide('model:chat', obj);

      let calls = 0;
      reg.subscribe('model:chat', () => calls++);
      reg.provide('model:chat', obj); // 同一引用，Object.is 相等

      expect(calls).toBe(0);
    });

    test('值变化（不同引用）触发通知', () => {
      const reg = new DependencyRegistry();
      reg.provide('model:chat', { id: 'm1' });

      let calls = 0;
      reg.subscribe('model:chat', () => calls++);
      reg.provide('model:chat', { id: 'm2' }); // 不同引用

      expect(calls).toBe(1);
      expect(reg.inject<{ id: string }>('model:chat')?.id).toBe('m2');
    });
  });

  describe('withdraw', () => {
    test('withdraw 先通知再移除', () => {
      const reg = new DependencyRegistry();
      const obj = { id: 'm1' };
      reg.provide('model:chat', obj);

      const received: DepChange[] = [];
      reg.subscribe('model:chat', (c) => received.push(c));

      reg.withdraw('model:chat');

      // 先收到 withdraw 通知
      expect(received).toHaveLength(1);
      expect(received[0].type).toBe('withdraw');
      expect(received[0].prev).toBe(obj);
      expect(received[0].next).toBeUndefined();
      // 再移除：inject 返回 undefined
      expect(reg.inject('model:chat')).toBeUndefined();
      expect(reg.size()).toBe(0);
    });

    test('withdraw 不存在的 key 静默跳过', () => {
      const reg = new DependencyRegistry();
      let calls = 0;
      reg.subscribe('nonexistent', () => calls++);
      reg.withdraw('nonexistent');
      expect(calls).toBe(0);
    });
  });

  describe('inject', () => {
    test('未就绪 inject 返回 undefined（等待而非报错）', () => {
      const reg = new DependencyRegistry();
      expect(reg.inject('not-ready')).toBeUndefined();
    });
  });

  describe('订阅回调抛错隔离', () => {
    test('单个订阅者抛错不影响其他订阅者与 provide 主流程', () => {
      const reg = new DependencyRegistry();
      const received: DepChange[] = [];

      reg.subscribe('model:chat', () => {
        throw new Error('订阅者 A 出错');
      });
      reg.subscribe('model:chat', (c) => received.push(c));

      // 不应抛出（EventBus 隔离监听器错误）
      reg.provide('model:chat', { id: 'm1' });

      expect(received).toHaveLength(1);
      expect(received[0].next).toEqual({ id: 'm1' });
    });
  });

  describe('订阅清理', () => {
    test('unsub 后不再收到通知', () => {
      const reg = new DependencyRegistry();
      let calls = 0;
      const unsub = reg.subscribe('model:chat', () => calls++);

      reg.provide('model:chat', { id: 'm1' });
      expect(calls).toBe(1);

      unsub();
      reg.provide('model:chat', { id: 'm2' });
      expect(calls).toBe(1); // unsub 后不再收到
    });
  });

  describe('realm 语义（T3.8）', () => {
    test('同 key 不同 realm 解析不同绑定（两级解析）', () => {
      const reg = new DependencyRegistry();
      reg.provideRealm('agentA', 'model:chat', { id: 'mA' });
      reg.provideRealm('agentB', 'model:chat', { id: 'mB' });

      expect(reg.injectRealm('agentA', 'model:chat')).toEqual({ id: 'mA' });
      expect(reg.injectRealm('agentB', 'model:chat')).toEqual({ id: 'mB' });
      // 默认绑定未提供 → undefined
      expect(reg.inject('model:chat')).toBeUndefined();
    });

    test('realm 绑定与默认绑定互不干扰', () => {
      const reg = new DependencyRegistry();
      reg.provide('model:chat', { id: 'default' });
      reg.provideRealm('agentA', 'model:chat', { id: 'mA' });

      expect(reg.inject('model:chat')).toEqual({ id: 'default' });
      expect(reg.injectRealm('agentA', 'model:chat')).toEqual({ id: 'mA' });
      // size 统计两者
      expect(reg.size()).toBe(2);
    });

    test('subscribeRealm 只收到本 realm 变更', () => {
      const reg = new DependencyRegistry();
      const received: DepChange[] = [];
      reg.subscribeRealm('agentA', 'model:chat', (c) => received.push(c));

      reg.provideRealm('agentB', 'model:chat', { id: 'mB' }); // 其他 realm → 不通知
      expect(received).toHaveLength(0);

      reg.provideRealm('agentA', 'model:chat', { id: 'mA' }); // 本 realm → 通知
      expect(received).toHaveLength(1);
      expect(received[0].type).toBe('provide');
      expect(received[0].next).toEqual({ id: 'mA' });
    });

    test('withdrawRealm 只影响本 realm', () => {
      const reg = new DependencyRegistry();
      reg.provideRealm('agentA', 'model:chat', { id: 'mA' });
      reg.provideRealm('agentB', 'model:chat', { id: 'mB' });

      let calls = 0;
      reg.subscribeRealm('agentB', 'model:chat', () => calls++);

      reg.withdrawRealm('agentA', 'model:chat');
      expect(reg.injectRealm('agentA', 'model:chat')).toBeUndefined();
      expect(reg.injectRealm('agentB', 'model:chat')).toEqual({ id: 'mB' });
      expect(calls).toBe(0); // agentB 订阅未收到 agentA 的 withdraw

      reg.withdrawRealm('agentB', 'model:chat');
      expect(calls).toBe(1);
      expect(reg.injectRealm('agentB', 'model:chat')).toBeUndefined();
    });
  });
});
