// MIT License
// Copyright (c) 2026 190615273@qq.com
// 输出侧护栏统一契约 + 注册表/管线用例（13-P2-1，2026-10-05）

import { describe, expect, it } from 'bun:test';
import {
  OutputGuardRegistry,
  getOutputGuardRegistry,
  resetOutputGuardRegistryForTest,
  runOutputGuards,
} from '@modules/core';
import type { OutputGuard } from '@modules/core';

function mkGuard(
  name: string,
  priority: number,
  verdict: ReturnType<OutputGuard['check']>
): OutputGuard {
  return { name, priority, check: () => verdict };
}

describe('runOutputGuards：顺序管线（13-P2-1）', () => {
  it('priority 升序执行，redact 累积改写（后者看到前者产物）', () => {
    const seen: string[] = [];
    const first: OutputGuard = {
      name: 'first',
      priority: 1,
      check: (t) => {
        seen.push(t);
        return {
          action: 'redact',
          text: t.replace('A', 'X'),
          issues: [{ guard: 'first', severity: 'warn', message: 'A→X' }],
        };
      },
    };
    const second: OutputGuard = {
      name: 'second',
      priority: 2,
      check: (t) => {
        seen.push(t);
        return { action: 'pass', issues: [] };
      },
    };
    const r = runOutputGuards([second, first], 'AB');
    expect(r.text).toBe('XB');
    expect(r.blocked).toBe(false);
    expect(r.redactedBy).toEqual(['first']);
    // 第二个护栏看到的是第一个的产物（顺序确实生效）
    expect(seen).toEqual(['AB', 'XB']);
  });

  it('block 立即短路：返回替代文本 + 原因，后续护栏不再执行', () => {
    let downstreamRan = false;
    const blocker = mkGuard('blocker', 1, {
      action: 'block',
      text: 'SAFE',
      issues: [{ guard: 'blocker', severity: 'block', message: '命中高危' }],
    });
    const downstream: OutputGuard = {
      name: 'downstream',
      priority: 2,
      check: () => {
        downstreamRan = true;
        return { action: 'pass', issues: [] };
      },
    };
    const r = runOutputGuards([blocker, downstream], 'SECRET');
    expect(r.blocked).toBe(true);
    expect(r.text).toBe('SAFE');
    expect(r.blockReason).toBe('命中高危');
    expect(downstreamRan).toBe(false);
  });

  it('block 未给替代文本 ⇒ 沿用当前进度文本，原因回退为「<name> 阻断」', () => {
    const r = runOutputGuards(
      [mkGuard('bare', 1, { action: 'block', issues: [] })],
      'RAW'
    );
    expect(r.blocked).toBe(true);
    expect(r.text).toBe('RAW');
    expect(r.blockReason).toBe('bare 阻断');
  });

  it('redact 但文本未变 ⇒ 不计入 redactedBy（避免假改写）', () => {
    const r = runOutputGuards(
      [mkGuard('noop', 1, { action: 'redact', text: 'SAME', issues: [] })],
      'SAME'
    );
    expect(r.redactedBy).toEqual([]);
    expect(r.text).toBe('SAME');
  });
});

describe('OutputGuardRegistry：命名注册（13-P2-1）', () => {
  it('同名 register 覆盖（幂等），list 按 priority 升序', () => {
    const reg = new OutputGuardRegistry();
    reg.register(mkGuard('b', 20, { action: 'pass', issues: [] }));
    reg.register(mkGuard('a', 10, { action: 'pass', issues: [] }));
    reg.register(mkGuard('b', 5, { action: 'pass', issues: [] }));
    expect(reg.list().map((g) => g.name)).toEqual(['b', 'a']);
    expect(reg.list()).toHaveLength(2);
  });

  it('unregister 返回是否确实移除', () => {
    const reg = new OutputGuardRegistry();
    reg.register(mkGuard('a', 1, { action: 'pass', issues: [] }));
    expect(reg.unregister('a')).toBe(true);
    expect(reg.unregister('a')).toBe(false);
    expect(reg.list()).toHaveLength(0);
  });

  it('run 与 runOutputGuards 同语义', () => {
    const reg = new OutputGuardRegistry();
    reg.register(mkGuard('a', 1, { action: 'pass', issues: [] }));
    expect(reg.run('x').text).toBe('x');
  });

  it('getOutputGuardRegistry 为单例；reset 后重建', () => {
    const a = getOutputGuardRegistry();
    expect(getOutputGuardRegistry()).toBe(a);
    resetOutputGuardRegistryForTest();
    expect(getOutputGuardRegistry()).not.toBe(a);
  });
});
