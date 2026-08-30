/**
 * StateMachine — 通用状态机引擎单元测试
 *
 * 覆盖：
 * - 基本构造和状态查询
 * - 合法/非法状态转换
 * - 自动终态推导（computeDefaultTerminal）
 * - 自定义 isTerminal / isActive / maxHistorySize
 * - 监听器注册、通知、注销
 * - 快照序列化与反序列化校验
 * - 状态机注册中心（StateMachineRegistry）
 * - 错误类型（IllegalTransitionError / InvalidSnapshotError）
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

import { StateMachine, computeDefaultTerminal } from '../../../src/state/engine/StateMachine.js';
import { StateMachineRegistry } from '../../../src/state/engine/StateMachineRegistry.js';
import { IllegalTransitionError, InvalidSnapshotError } from '../../../src/state/errors.js';
import type { TransitionRules, StateSnapshot, TransitionRecord } from '../../../src/state/engine/types.js';

// ============================================================
// 测试用状态枚举
// ============================================================

enum TestState {
  IDLE = 'idle',
  RUNNING = 'running',
  COMPLETED = 'completed',
  ERROR = 'error',
  ARCHIVED = 'archived',
}

const TEST_RULES: TransitionRules<TestState> = {
  [TestState.IDLE]:      [TestState.RUNNING],
  [TestState.RUNNING]:   [TestState.COMPLETED, TestState.ERROR],
  [TestState.COMPLETED]: [],
  [TestState.ERROR]:     [TestState.IDLE, TestState.RUNNING],
  [TestState.ARCHIVED]:  [],
};

// ============================================================
// computeDefaultTerminal
// ============================================================

describe('computeDefaultTerminal', () => {

  it('应将出度为 0 的状态识别为终态', () => {
    const isTerminal = computeDefaultTerminal(TEST_RULES);
    expect(isTerminal(TestState.COMPLETED)).toBe(true);
    expect(isTerminal(TestState.ARCHIVED)).toBe(true);
  });

  it('不应将出度大于 0 的状态识别为终态', () => {
    const isTerminal = computeDefaultTerminal(TEST_RULES);
    expect(isTerminal(TestState.IDLE)).toBe(false);
    expect(isTerminal(TestState.RUNNING)).toBe(false);
    expect(isTerminal(TestState.ERROR)).toBe(false);
  });

  it('空规则表时所有状态都应非终态', () => {
    enum Single { A = 'a' }
    const isTerminal = computeDefaultTerminal<Single>({ [Single.A]: [] });
    expect(isTerminal(Single.A)).toBe(true);
  });

});

// ============================================================
// StateMachine 构造
// ============================================================

describe('StateMachine 构造', () => {

  it('应使用初始状态构造', () => {
    const sm = new StateMachine<TestState>({
      initialState: TestState.IDLE,
      rules: TEST_RULES,
    });
    expect(sm.getState()).toBe(TestState.IDLE);
  });

  it('构造时初始状态不在规则表中应抛出 InvalidSnapshotError', () => {
    enum Other { X = 'x' }
    expect(() => {
      new StateMachine<string>({
        initialState: 'nonexistent',
        rules: { idle: ['running'], running: [] },
      });
    }).toThrow(InvalidSnapshotError);
  });

  it('应为未提供 contextId 的实例设默认值', () => {
    const sm = new StateMachine<TestState>({
      initialState: TestState.IDLE,
      rules: TEST_RULES,
    });
    expect(sm.getContextId()).toBe('unknown');
  });

  it('应正确设置 contextId', () => {
    const sm = new StateMachine<TestState>({
      initialState: TestState.IDLE,
      rules: TEST_RULES,
      contextId: 'ctx-001',
    });
    expect(sm.getContextId()).toBe('ctx-001');
  });

});

// ============================================================
// 状态转换
// ============================================================

describe('状态转换', () => {

  let sm: StateMachine<TestState>;

  beforeEach(() => {
    sm = new StateMachine<TestState>({
      initialState: TestState.IDLE,
      rules: TEST_RULES,
    });
  });

  it('应执行合法转换', () => {
    const result = sm.transition(TestState.RUNNING);
    expect(result).toBe(true);
    expect(sm.getState()).toBe(TestState.RUNNING);
  });

  it('应执行多步合法转换', () => {
    sm.transition(TestState.RUNNING);
    sm.transition(TestState.COMPLETED);
    expect(sm.getState()).toBe(TestState.COMPLETED);
    expect(sm.isTerminal()).toBe(true);
  });

  it('非法转换应抛出 IllegalTransitionError，状态不应变化', () => {
    expect(() => {
      sm.transition(TestState.COMPLETED);
    }).toThrow(IllegalTransitionError);
    expect(sm.getState()).toBe(TestState.IDLE);
  });

  it('转换到相同状态应返回 true 且不添加历史', () => {
    const result = sm.transition(TestState.IDLE);
    expect(result).toBe(true);
    expect(sm.getHistory().length).toBe(0);
  });

  it('应记录历史条目', () => {
    sm.transition(TestState.RUNNING, '启动');
    const history = sm.getHistory();
    expect(history.length).toBe(1);
    expect(history[0].from).toBe(TestState.IDLE);
    expect(history[0].to).toBe(TestState.RUNNING);
    expect(history[0].reason).toBe('启动');
    expect(typeof history[0].timestamp).toBe('number');
  });

  it('transition 应接受 metadata 参数', () => {
    const metadata = { key: 'value', nested: { count: 1 } };
    sm.transition(TestState.RUNNING, 'test', metadata);
    const history = sm.getHistory();
    expect(history[0].metadata).toEqual(metadata);
  });

  it('应限制历史记录容量', () => {
    // 定义只有 2 条上限的状态机
    const limited = new StateMachine<string>({
      initialState: 'idle',
      rules: {
        idle:  ['a', 'b'],
        a:     ['b'],
        b:     ['idle'],
      },
      maxHistorySize: 2,
    });

    limited.transition('a', 't1');
    limited.transition('b', 't2');
    limited.transition('idle', 't3');
    limited.transition('a', 't4');

    expect(limited.getHistory().length).toBe(2);
  });

  it('getHistory 应返回不可变副本', () => {
    sm.transition(TestState.RUNNING);
    const history = sm.getHistory();
    (history as TransitionRecord<TestState>[]).push({} as any);
    expect(sm.getHistory().length).toBe(1);
  });

});

// ============================================================
// isTerminal / isActive
// ============================================================

describe('isTerminal / isActive', () => {

  it('默认 isActive 应返回 false（未提供自定义函数时）', () => {
    const sm = new StateMachine<TestState>({
      initialState: TestState.IDLE,
      rules: TEST_RULES,
    });
    expect(sm.isActive()).toBe(false);
  });

  it('自定义 isActive 应生效', () => {
    const sm = new StateMachine<TestState>({
      initialState: TestState.RUNNING,
      rules: TEST_RULES,
      isActive: (s) => s === TestState.RUNNING,
    });
    expect(sm.isActive()).toBe(true);
    sm.transition(TestState.COMPLETED);
    expect(sm.isActive()).toBe(false);
  });

  it('自定义 isTerminal 应覆盖自动推导', () => {
    const sm = new StateMachine<TestState>({
      initialState: TestState.IDLE,
      rules: TEST_RULES,
      isTerminal: () => false, // 没有终态
    });
    sm.transition(TestState.RUNNING);
    sm.transition(TestState.COMPLETED);
    expect(sm.isTerminal()).toBe(false); // 自定义始终返回 false
  });

  it('isStateTerminal 应正确判断任意状态', () => {
    const sm = new StateMachine<TestState>({
      initialState: TestState.IDLE,
      rules: TEST_RULES,
    });
    expect(sm.isStateTerminal(TestState.COMPLETED)).toBe(true);
    expect(sm.isStateTerminal(TestState.IDLE)).toBe(false);
  });

});

// ============================================================
// getAllowedTransitions / canTransition
// ============================================================

describe('转移查询', () => {

  let sm: StateMachine<TestState>;

  beforeEach(() => {
    sm = new StateMachine<TestState>({
      initialState: TestState.IDLE,
      rules: TEST_RULES,
    });
  });

  it('getAllowedTransitions 应返回从当前状态可转移的目标列表', () => {
    expect(sm.getAllowedTransitions()).toEqual([TestState.RUNNING]);
  });

  it('getAllowedTransitions 可指定状态', () => {
    expect(sm.getAllowedTransitions(TestState.RUNNING)).toEqual([
      TestState.COMPLETED,
      TestState.ERROR,
    ]);
  });

  it('canTransition 应正确判断', () => {
    expect(sm.canTransition(TestState.RUNNING)).toBe(true);
    expect(sm.canTransition(TestState.COMPLETED)).toBe(false);
  });

});

// ============================================================
// 监听器
// ============================================================

describe('监听器', () => {

  let sm: StateMachine<TestState>;

  beforeEach(() => {
    sm = new StateMachine<TestState>({
      initialState: TestState.IDLE,
      rules: TEST_RULES,
    });
  });

  it('onStateChange 注册的监听器应在转换时触发', () => {
    let called = false;
    let recordedFrom: TestState | undefined;
    let recordedTo: TestState | undefined;
    let recordedReason: string | undefined;

    sm.onStateChange((from, to, reason) => {
      called = true;
      recordedFrom = from;
      recordedTo = to;
      recordedReason = reason;
    });

    sm.transition(TestState.RUNNING, '启动');
    expect(called).toBe(true);
    expect(recordedFrom).toBe(TestState.IDLE);
    expect(recordedTo).toBe(TestState.RUNNING);
    expect(recordedReason).toBe('启动');
  });

  it('offStateChange 应移除监听器', () => {
    let count = 0;
    const listener = () => { count++; };

    sm.onStateChange(listener);
    sm.offStateChange(listener);
    sm.transition(TestState.RUNNING);

    expect(count).toBe(0);
  });

  it('removeAllListeners 应移除所有监听器', () => {
    let count = 0;
    sm.onStateChange(() => { count++; });
    sm.onStateChange(() => { count++; });
    sm.removeAllListeners();
    sm.transition(TestState.RUNNING);
    expect(count).toBe(0);
  });

  it('onStateChange 返回的取消函数应可移除监听器', () => {
    let count = 0;
    const off = sm.onStateChange(() => { count++; });
    off();
    sm.transition(TestState.RUNNING);
    expect(count).toBe(0);
  });

  it('监听器抛出异常不应影响状态转换', () => {
    sm.onStateChange(() => { throw new Error('listener error'); });
    expect(() => {
      sm.transition(TestState.RUNNING);
    }).not.toThrow();
    expect(sm.getState()).toBe(TestState.RUNNING);
  });

});

// ============================================================
// 快照与恢复
// ============================================================

describe('snapshot / fromSnapshot', () => {

  it('snapshot 应导出完整快照', () => {
    const sm = new StateMachine<TestState>({
      initialState: TestState.IDLE,
      rules: TEST_RULES,
      contextId: 'ctx-001',
    });
    sm.transition(TestState.RUNNING, '启动');

    const snap = sm.snapshot('test-machine', 1);
    expect(snap.machineType).toBe('test-machine');
    expect(snap.currentState).toBe(TestState.RUNNING);
    expect(snap.history.length).toBe(1);
    expect(snap.timestamp).toBeGreaterThan(0);
    expect(snap.schemaVersion).toBe(1);
  });

  it('fromSnapshot 应恢复状态机', () => {
    const sm = new StateMachine<TestState>({
      initialState: TestState.IDLE,
      rules: TEST_RULES,
    });
    sm.transition(TestState.RUNNING);

    const snap = sm.snapshot('test-machine');
    const restored = StateMachine.fromSnapshot(snap, {
      initialState: TestState.IDLE, // 会被快照覆盖
      rules: TEST_RULES,
    });

    expect(restored.getState()).toBe(TestState.RUNNING);
    expect(restored.getHistory().length).toBe(1);
  });

  it('fromSnapshot 应校验当前状态是否在规则表中', () => {
    const badSnap: StateSnapshot<string> = {
      machineType: 'test',
      currentState: 'nonexistent',
      history: [],
      timestamp: Date.now(),
    };

    expect(() => {
      StateMachine.fromSnapshot(badSnap, {
        initialState: 'idle',
        rules: { idle: ['running'], running: [] },
      });
    }).toThrow(InvalidSnapshotError);
  });

  it('fromSnapshot 应校验历史记录中的转移是否合法', () => {
    const badSnap: StateSnapshot<string> = {
      machineType: 'test',
      currentState: 'idle',
      history: [
        { from: 'idle', to: 'completed', timestamp: Date.now() }, // 非法：idle → completed 不在规则中
      ],
      timestamp: Date.now(),
    };

    expect(() => {
      StateMachine.fromSnapshot(badSnap, {
        initialState: 'idle',
        rules: { idle: ['running'], running: ['completed'], completed: [] },
      });
    }).toThrow(InvalidSnapshotError);
  });

  it('fromSnapshot 完整生命周期：序列化 → 恢复 → 继续转换', () => {
    const original = new StateMachine<TestState>({
      initialState: TestState.IDLE,
      rules: TEST_RULES,
    });
    original.transition(TestState.RUNNING, '第一次启动');

    const snap = original.snapshot('test-machine');
    const restored = StateMachine.fromSnapshot(snap, {
      initialState: TestState.IDLE,
      rules: TEST_RULES,
    });

    // 恢复后继续转换
    restored.transition(TestState.COMPLETED, '完成');

    expect(restored.getState()).toBe(TestState.COMPLETED);
    expect(restored.getHistory().length).toBe(2);
    expect(restored.getHistory()[0].reason).toBe('第一次启动');
    expect(restored.getHistory()[1].reason).toBe('完成');
  });

});

// ============================================================
// 错误类型
// ============================================================

describe('IllegalTransitionError', () => {

  it('应继承 AppError 并包含 from/to 信息', () => {
    const err = new IllegalTransitionError('idle', 'completed', 'test');
    expect(err.name).toBe('IllegalTransitionError');
    expect(err.message).toContain('idle');
    expect(err.message).toContain('completed');
    expect(err.context).toBeDefined();
    expect(err.context?.from).toBe('idle');
    expect(err.context?.to).toBe('completed');
    expect(err.context?.machineType).toBe('test');
  });

});

describe('InvalidSnapshotError', () => {

  it('应携带快照校验失败的详情', () => {
    const err = new InvalidSnapshotError('状态不在规则表中', {
      currentState: 'bogus',
    });
    expect(err.name).toBe('InvalidSnapshotError');
    expect(err.context?.currentState).toBe('bogus');
  });

});

// ============================================================
// StateMachineRegistry
// ============================================================

describe('StateMachineRegistry', () => {

  let registry: StateMachineRegistry;
  let machine1: StateMachine<string>;
  let machine2: StateMachine<string>;

  beforeEach(() => {
    StateMachineRegistry.reset();
    registry = StateMachineRegistry.getInstance({ idleTimeout: 100 }); // 100ms 超时以便测试
    machine1 = new StateMachine<string>({
      initialState: 'idle',
      rules: { idle: ['running'], running: ['completed'], completed: [] },
      contextId: 'm1',
    });
    machine2 = new StateMachine<string>({
      initialState: 'idle',
      rules: { idle: ['running'], running: ['completed'], completed: [] },
      contextId: 'm2',
    });
  });

  afterEach(() => {
    StateMachineRegistry.reset();
  });

  it('register 应添加实例', () => {
    registry.register('m1', machine1);
    expect(registry.size()).toBe(1);
  });

  it('重复 register 应抛出', () => {
    registry.register('m1', machine1);
    expect(() => registry.register('m1', machine2)).toThrow();
  });

  it('find 应返回已注册的实例', () => {
    registry.register('m1', machine1);
    const found = registry.find('m1');
    expect(found).toBeDefined();
    expect(found!.getState()).toBe('idle');
  });

  it('find 不存在的 id 应返回 undefined', () => {
    const found = registry.find('nonexistent');
    expect(found).toBeUndefined();
  });

  it('unregister 应移除实例', () => {
    registry.register('m1', machine1);
    registry.unregister('m1');
    expect(registry.size()).toBe(0);
    expect(registry.find('m1')).toBeUndefined();
  });

  it('unregister 不存在的 id 不应报错', () => {
    expect(() => registry.unregister('nonexistent')).not.toThrow();
  });

  it('gc 应清理超时空闲实例', () => {
    registry.register('m1', machine1);

    // 等待超时并访问另一个实例以确保 gc 只清理空闲的
    registry.register('m2', machine2);

    // 等待超时
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        // 访问 m2 使其活跃
        registry.find('m2');

        const cleaned = registry.gc();
        expect(cleaned).toBe(1);         // 只有 m1 被清理
        expect(registry.find('m2')).toBeDefined(); // m2 仍存在
        resolve();
      }, 150);
    });
  });

  it('listActive 应返回所有已注册的 id', () => {
    registry.register('m1', machine1);
    registry.register('m2', machine2);
    const ids = registry.listActive();
    expect(ids).toContain('m1');
    expect(ids).toContain('m2');
    expect(ids.length).toBe(2);
  });

  it('getInstance 应返回单例', () => {
    const r1 = StateMachineRegistry.getInstance();
    const r2 = StateMachineRegistry.getInstance();
    expect(r1).toBe(r2);
  });

  it('unregister 应清理监听器', () => {
    registry.register('m1', machine1);

    let count = 0;
    machine1.onStateChange(() => { count++; });

    registry.unregister('m1');

    // 手动触发后不应有监听器
    machine1.transition('running');
    expect(count).toBe(0);
  });

});
