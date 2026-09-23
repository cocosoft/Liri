/**
 * 事件循环阻塞探针 · P2 阶段标签（2026-09-22）
 *
 * 锁定：配对语义、不配对静默忽略（不抛）、嵌套栈、环形容量、深度上限、
 * 归因判据（`suspects` 与 lag 互相印证）、关闭档位零开销。
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  currentPhase,
  enterPhase,
  exitPhase,
  isPhaseStackEnabled,
  recentPhases,
  resetPhaseStack,
  setPhaseStackEnabled,
  snapshotPhases,
} from '../../src/diagnostics/loopProbe/phaseStack';

beforeEach(() => {
  setPhaseStackEnabled(true);
  resetPhaseStack();
});

afterEach(() => {
  setPhaseStackEnabled(true);
  resetPhaseStack();
});

describe('配对语义', () => {
  test('enter/exit 配对后进入最近列表', () => {
    enterPhase('fts:saveToDisk');
    expect(currentPhase()).toBe('fts:saveToDisk');
    exitPhase('fts:saveToDisk');

    expect(currentPhase()).toBeNull();
    const recent = recentPhases();
    expect(recent).toHaveLength(1);
    expect(recent[0].name).toBe('fts:saveToDisk');
    expect(recent[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  test('不配对的 exit 静默忽略（不抛、不污染状态）', () => {
    enterPhase('a');
    expect(() => exitPhase('b')).not.toThrow(); // 栈顶是 a，退出 b ⇒ 忽略
    expect(currentPhase()).toBe('a');
    expect(recentPhases()).toHaveLength(0);

    exitPhase('a');
    expect(() => exitPhase('a')).not.toThrow(); // 空栈再退 ⇒ 忽略
    expect(recentPhases()).toHaveLength(1);
  });

  test('嵌套：最内层为 current，退出顺序决定最近列表次序', () => {
    enterPhase('outer');
    enterPhase('inner');
    expect(currentPhase()).toBe('inner');

    exitPhase('inner');
    expect(currentPhase()).toBe('outer');
    exitPhase('outer');
    expect(currentPhase()).toBeNull();

    // 最新的在最前：inner 先结束，outer 后结束 ⇒ outer 更新
    expect(recentPhases().map((p) => p.name)).toEqual(['outer', 'inner']);
  });
});

describe('容量与越界保护（探针不得自身成为增长点）', () => {
  test('环形缓冲上限 32：超出后只保留最新 32 条', () => {
    for (let i = 0; i < 40; i++) {
      enterPhase(`p${i}`);
      exitPhase(`p${i}`);
    }
    const recent = recentPhases();
    expect(recent).toHaveLength(32);
    expect(recent[0].name).toBe('p39'); // 最新在前
  });

  test('深度上限 64：超深嵌套放弃记录，且不破坏已有栈', () => {
    for (let i = 0; i < 100; i++) enterPhase(`d${i}`);
    // 只记录了前 64 层（其余被放弃），current 为第 64 层
    expect(currentPhase()).toBe('d63');

    // 全部退出（必须与压入顺序**逆序**；乱序的 exit 会被忽略，见上一组用例）
    for (let i = 99; i >= 0; i--) exitPhase(`d${i}`);
    expect(currentPhase()).toBeNull();
    expect(recentPhases()).toHaveLength(32); // 环形缓冲上限
  });
});

describe('阻塞归因判据（阶段自记时长 × 心跳 lag）', () => {
  test('未达判据下界的快阶段不算疑似（门槛 = max(1s, lag/2)）', async () => {
    enterPhase('fast');
    exitPhase('fast');

    // lag=8000 ⇒ 门槛 4000ms ⇒ 微秒级阶段不入选（避免抖动噪声）
    expect(snapshotPhases(8000).suspects).toEqual([]);
    expect(snapshotPhases(8000).recent.map((p) => p.name)).toContain('fast');
  });

  test('自记时长 ≥ 门槛的阶段被判为疑似（按时长降序）', async () => {
    enterPhase('slow-blocker');
    // 让阶段自记时长 ≈1.1s（用 setTimeout 而非 Bun.sleep —— 后者在 tsc 类型面不可用）
    await new Promise((resolve) => setTimeout(resolve, 1100));
    exitPhase('slow-blocker');

    enterPhase('tiny');
    exitPhase('tiny');

    // lag=2000 ⇒ 门槛 max(1000, 1000) = 1000ms ⇒ 1.1s 的阶段入选，微秒级不入选
    expect(snapshotPhases(2000).suspects.map((p) => p.name)).toEqual([
      'slow-blocker',
    ]);
    // lag=8000 ⇒ 门槛 4000ms ⇒ 同一阶段不再入选（判据随 lag 收紧）
    expect(snapshotPhases(8000).suspects).toEqual([]);
  });

  test('活跃阶段被一并带出（阻塞仍在进行时）', () => {
    enterPhase('running-now');
    const snap = snapshotPhases(5000);
    expect(snap.current).toBe('running-now');
    expect(snap.activeStack).toEqual(['running-now']);
    exitPhase('running-now');
  });
});

describe('关闭档位：零开销', () => {
  test('disabled ⇒ enter/exit 均为 no-op，快照为空', () => {
    setPhaseStackEnabled(false);
    expect(isPhaseStackEnabled()).toBe(false);

    enterPhase('x');
    expect(currentPhase()).toBeNull();
    exitPhase('x');
    expect(recentPhases()).toHaveLength(0);
    expect(snapshotPhases(9000).suspects).toEqual([]);
  });

  test('重新启用后可正常记录（关闭时已清空历史）', () => {
    enterPhase('before');
    exitPhase('before');
    setPhaseStackEnabled(false);
    setPhaseStackEnabled(true);

    expect(recentPhases()).toHaveLength(0);
    enterPhase('after');
    exitPhase('after');
    expect(recentPhases()[0].name).toBe('after');
  });
});
